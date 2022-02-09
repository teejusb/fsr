#!/usr/bin/env python
import asyncio
import logging
import os
import socket
import sys
from collections import OrderedDict
from random import normalvariate

import serial
from aiohttp import web, WSMsgType
from aiohttp.web import json_response

logger = logging.getLogger(__name__)

# Edit this to match the serial port name shown in Arduino IDE
SERIAL_PORT = "/dev/ttyACM0"
HTTP_PORT = 5000

# Amount of panels.
num_panels = 4

# Initialize panel ids.
sensor_numbers = range(num_panels)

# Used for developmental purposes. Set this to true when you just want to
# emulate the serial device instead of actually connecting to one.
NO_SERIAL = False

# Track whether there is an active serial connection
serial_connected = False

# Queue for websocket Tasks to pass messages they receive from clients to the run_websockets task.
receive_queue = asyncio.Queue(maxsize=1)

# Used to coordinate updates to app['websockets'] set
websockets_lock = asyncio.Lock()

class ProfileHandler(object):
  """
  A class to handle all the profile modifications.

  Attributes:
    filename: string, the filename where to read/write profile data.
    profiles: OrderedDict, the profile data loaded from the file.
    cur_profile: string, the name of the current active profile.
    loaded: bool, whether or not the backend has already loaded the
      profile data file or not.
  """
  def __init__(self, filename='profiles.txt'):
    self.filename = filename
    self.profiles = OrderedDict()
    self.cur_profile = ''
    # Have a default no-name profile we can use in case there are no profiles.
    self.profiles[''] = [0] * num_panels

  def __PersistProfiles(self):
    with open(self.filename, 'w') as f:
      for name, thresholds in self.profiles.items():
        if name:
          f.write(name + ' ' + ' '.join(map(str, thresholds)) + '\n')

  def Load(self):
    num_profiles = 0
    if os.path.exists(self.filename):
      with open(self.filename, 'r') as f:
        for line in f:
          parts = line.split()
          if len(parts) == (num_panels+1):
            self.profiles[parts[0]] = [int(x) for x in parts[1:]]
            num_profiles += 1
            # Change to the first profile found.
            if num_profiles == 1:
              self.ChangeProfile(parts[0])
    else:
      open(self.filename, 'w').close()
    print('Found Profiles: ' + str(list(self.profiles.keys())))

  def GetCurThresholds(self):
    if not self.cur_profile in self.profiles:
      raise RuntimeError("Current profile name is missing from profile list")
    return self.profiles[self.cur_profile]

  def UpdateThresholds(self, index, value):
    if not self.cur_profile in self.profiles:
      raise RuntimeError("Current profile name is missing from profile list")
    self.profiles[self.cur_profile][index] = value
    self.__PersistProfiles()

  def ChangeProfile(self, profile_name):
    if not profile_name in self.profiles:
      print(profile_name, " not in ", self.profiles)
      raise RuntimeError("Selected profile name is missing from profile list")
    self.cur_profile = profile_name

  def GetProfileNames(self):
    return [name for name in self.profiles.keys() if name]

  def AddProfile(self, profile_name, thresholds):
    self.profiles[profile_name] = thresholds
    if self.cur_profile == '':
      self.profiles[''] = [0] * num_panels
    self.ChangeProfile(profile_name)
    self.__PersistProfiles()

  def RemoveProfile(self, profile_name):
    if not profile_name in self.profiles:
      print(profile_name, " not in ", self.profiles)
      raise RuntimeError("Selected profile name is missing from profile list")
    del self.profiles[profile_name]
    if profile_name == self.cur_profile:
      self.ChangeProfile('')
    self.__PersistProfiles()

  def GetCurrentProfile(self):
    return self.cur_profile

class FakeSerialHandler(object):
  def __init__(self):
    self.__is_open = False
     # Use this to store the values when emulating serial so the graph isn't too
     # jumpy. Only used when NO_SERIAL is true.
    self.__no_serial_values = [0] * num_panels
    self.__thresholds = [0] * num_panels

  def Open(self):
    self.__is_open = True

  def Close(self):
    self.__is_open = False  

  def isOpen(self):
    return self.__is_open

  def Send(self, command):
    if command == 'v\n':
      offsets = [int(normalvariate(0, num_panels+1)) for _ in range(num_panels)]
      self.__no_serial_values = [
        max(0, min(self.__no_serial_values[i] + offsets[i], 1023))
        for i in range(num_panels)
      ]
      return 'v', self.__no_serial_values.copy()
    elif command == 't\n':
      return 't', self.__thresholds.copy()
    elif "0123456789".find(command[0]) != -1:
      sensor_index = int(command[0])
      self.__thresholds[sensor_index] = int(command[1:])
      return 't', self.__thresholds.copy()

class CommandFormatError(Exception):
  pass

class SerialHandler(object):
  """
  A class to handle all the serial interactions.

  Attributes:
    ser: Serial, the serial object opened by this class.
    port: string, the path/name of the serial object to open.
    timeout: int, the time in seconds indicating the timeout for serial
      operations.
  """
  def __init__(self, port, timeout=1):
    self.ser = None
    self.port = port
    self.timeout = timeout
  
  def Open(self):
    self.ser = serial.Serial(self.port, 115200, timeout=self.timeout)

  def Close(self):
    if self.ser and not self.ser.closed:
      self.ser.close()
    self.ser = None
  
  def isOpen(self):
    return self.ser and self.ser.isOpen()

  def Send(self, command):
    self.ser.write(command.encode())

    line = self.ser.readline().decode('ascii')

    if not line.endswith('\n'):
      raise TimeoutError('Timeout reading response to command. {} {}'.format(command, line))

    line = line.strip()

    # All commands are of the form:
    #   cmd num1 num2 num3 num4
    parts = line.split()
    if len(parts) != num_panels + 1:
      raise CommandFormatError('Command response "{}" had length {}, expected length was {}'.format(line, len(parts), num_panels + 1))
    cmd = parts[0]
    values = [int(x) for x in parts[1:]]
    return cmd, values


async def run_websockets(app, serial_handler, profile_handler):
  global serial_connected
  async def send_json_all(msg):
    websockets = app['websockets'].copy()
    for ws in websockets:
      if not ws.closed:
        await ws.send_json(msg)

  async def update_threshold(values, index):
    profile_handler.UpdateThresholds(index, values[index])
    threshold_cmd = str(sensor_numbers[index]) + str(values[index]) + '\n'
    await asyncio.to_thread(lambda: serial_handler.Send(threshold_cmd))
    await send_json_all(['thresholds', {'thresholds': profile_handler.GetCurThresholds()}])
    print('Thresholds are: ' + str(profile_handler.GetCurThresholds()))

  async def add_profile(profile_name, thresholds):
    profile_handler.AddProfile(profile_name, thresholds)
    # When we add a profile, we are using the currently loaded thresholds so we
    # don't need to explicitly apply anything.
    await send_json_all(['get_profiles', {'profiles': profile_handler.GetProfileNames()}])
    print('Added profile "{}" with thresholds: {}'.format(
      profile_handler.GetCurrentProfile(), str(profile_handler.GetCurThresholds())))
    await send_json_all(['get_cur_profile', {'cur_profile': profile_handler.GetCurrentProfile()}])
    print('Changed to profile "{}" with thresholds: {}'.format(
      profile_handler.GetCurrentProfile(), str(profile_handler.GetCurThresholds())))

  async def remove_profile(profile_name):
    profile_handler.RemoveProfile(profile_name)
    # Need to apply the thresholds of the profile we've fallen back to.
    thresholds = profile_handler.GetCurThresholds()
    for i in range(len(thresholds)):
      await update_threshold(thresholds, i)
    await send_json_all(['get_profiles', {'profiles': profile_handler.GetProfileNames()}])
    await send_json_all(['get_cur_profile', {'cur_profile': profile_handler.GetCurrentProfile()}])
    print('Removed profile "{}". Current thresholds are: {}'.format(
      profile_name, str(profile_handler.GetCurThresholds())))

  async def change_profile(profile_name):
    profile_handler.ChangeProfile(profile_name)
    # Need to apply the thresholds of the profile we've changed to.
    thresholds = profile_handler.GetCurThresholds()
    for i in range(len(thresholds)):
      await update_threshold(thresholds, i)
    await send_json_all(['get_cur_profile', {'cur_profile': profile_handler.GetCurrentProfile()}])
    print('Changed to profile "{}" with thresholds: {}'.format(
      profile_handler.GetCurrentProfile(), str(profile_handler.GetCurThresholds())))

  async def get_values():
    try:
      return await asyncio.to_thread(lambda: serial_handler.Send('v\n'))
    except CommandFormatError as e:
      logger.exception("Bad response from v command: %s", e)
      sys.exit(1)
  
  async def report_values(values):
    await send_json_all(['values', {'values': values}])

  poll_values_wait_seconds = 0.01

  async def task_loop():
    poll_values_task = asyncio.create_task(asyncio.sleep(poll_values_wait_seconds))
    receive_queue_task = asyncio.create_task(receive_queue.get())
    while True:
      done, pending = await asyncio.wait([poll_values_task, receive_queue_task], return_when=asyncio.FIRST_COMPLETED)

      for task in done:
        if task == poll_values_task:
          if len(app['websockets']) > 0:
            v, values = await get_values()
            await report_values(values)
          poll_values_task = asyncio.create_task(asyncio.sleep(poll_values_wait_seconds))
        if task == receive_queue_task:
          data = await task

          action = data[0]

          if action == 'update_threshold':
            values, index = data[1:]
            await update_threshold(values, index)
          elif action == 'add_profile':
            profile_name, thresholds = data[1:]
            await add_profile(profile_name, thresholds)
          elif action == 'remove_profile':
            profile_name, = data[1:]
            await remove_profile(profile_name)
          elif action == 'change_profile':
            profile_name, = data[1:]
            await change_profile(profile_name)
          receive_queue.task_done()
          receive_queue_task = asyncio.create_task(receive_queue.get())
  
  while True:
    try:
      await asyncio.to_thread(lambda: serial_handler.Open())
      print('Serial connected')
      serial_connected = True
    except serial.SerialException as e:
      logger.exception('Can\'t connect to serial: %s', e)
      await asyncio.sleep(3)
      continue
    try:
      # Send current thresholds on connect
      cur_thresholds = profile_handler.GetCurThresholds()
      for i, threshold in enumerate(cur_thresholds):
        threshold_cmd = str(i) + str(threshold) + '\n'
        t, thresholds = await asyncio.to_thread(lambda: serial_handler.Send(threshold_cmd))
      if not str(cur_thresholds) == str(thresholds):
        print('Microcontroller did not save thresholds. Profile: {}, MCU: {}'.format(str(cur_thresholds), str(thresholds)))
        sys.exit(1)
      await task_loop()
    except serial.SerialException as e:
      # In case of serial error, disconnect all clients. The WebUI will try to reconnect.
      logger.exception('Serial error: %s', e)
      serial_connected = False
      async with websockets_lock:
        for task in app['websocket-tasks']:
          task.cancel()

def make_get_defaults(profile_handler):
  async def get_defaults(request):
    if not serial_connected:
     return json_response({}, status=503)
    return json_response({
      'profiles': profile_handler.GetProfileNames(),
      'cur_profile': profile_handler.GetCurrentProfile(),
      'thresholds': profile_handler.GetCurThresholds()
    })
  return get_defaults

async def get_ws(request):
  if not serial_connected:
    return json_response({}, status=503)
  this_task = asyncio.current_task()
  ws = web.WebSocketResponse()
  await ws.prepare(request)

  async with websockets_lock:
    request.app['websockets'].add(ws)
    request.app['websocket-tasks'].add(this_task)
  print('Client connected')
  
  try:
    while not ws.closed:
      msg = await ws.receive()
      if msg.type == WSMsgType.CLOSE:
        break
      elif msg.type == WSMsgType.TEXT:
        data = msg.json()
      await receive_queue.put(data)
  finally:
    async with websockets_lock:
      request.app['websockets'].remove(ws)
      request.app['websocket-tasks'].remove(this_task)
    await ws.close()
    print('Client disconnected')

build_dir = os.path.abspath(
  os.path.join(os.path.dirname(__file__), '..', 'build')
)

async def get_index(request):
  return web.FileResponse(os.path.join(build_dir, 'index.html'))

async def on_shutdown(app):
  async with websockets_lock:
    for task in app['websocket-tasks']:
      task.cancel()

def main():
  profile_handler = ProfileHandler()
  profile_handler.Load()

  if NO_SERIAL:
    serial_handler = FakeSerialHandler()
  else:
    serial_handler = SerialHandler(port=SERIAL_PORT, timeout=0.05)

  async def on_startup(app):
    asyncio.create_task(run_websockets(app=app, serial_handler=serial_handler, profile_handler=profile_handler))

  app = web.Application()

  # Set of open websockets used to broadcast messages to all clients.
  app['websockets'] = set()
  # Set of open websocket tasks to cancel when the app shuts down.
  app['websocket-tasks'] = set()

  app.add_routes([
    web.get('/defaults', make_get_defaults(profile_handler)),
    web.get('/ws', get_ws),
  ])
  if not NO_SERIAL:
    app.add_routes([
      web.get('/', get_index),
      web.get('/plot', get_index),
      web.static('/', build_dir),
    ])
  app.on_shutdown.append(on_shutdown)
  app.on_startup.append(on_startup)

  hostname = socket.gethostname()
  ip_address = socket.gethostbyname(hostname)
  print(' * WebUI can be found at: http://' + ip_address + ':' + str(HTTP_PORT))

  web.run_app(app, port=HTTP_PORT)

if __name__ == '__main__':
  main()
