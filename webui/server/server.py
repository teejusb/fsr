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

# Used for developmental purposes. Set this to true when you just want to
# emulate the serial device instead of actually connecting to one.
NO_SERIAL = False

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
  def __init__(self, num_sensors, filename='profiles.txt'):
    self.num_sensors = num_sensors
    self.filename = filename
    self.profiles = OrderedDict()
    self.cur_profile = ''
    # Have a default no-name profile we can use in case there are no profiles.
    self.profiles[''] = [0] * self.num_sensors

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
          if len(parts) == (self.num_sensors + 1):
            self.profiles[parts[0]] = [int(x) for x in parts[1:]]
            num_profiles += 1
            # Change to the first profile found.
            if num_profiles == 1:
              self.ChangeProfile(parts[0])
    else:
      open(self.filename, 'w').close()

  def GetCurThresholds(self):
    if not self.cur_profile in self.profiles:
      raise RuntimeError("Current profile name is missing from profile list")
    return self.profiles[self.cur_profile]

  def UpdateThreshold(self, index, value):
    if not self.cur_profile in self.profiles:
      raise RuntimeError("Current profile name is missing from profile list")
    self.profiles[self.cur_profile][index] = value
    self.__PersistProfiles()

  def UpdateThresholds(self, values):
    if not self.cur_profile in self.profiles:
      raise RuntimeError("Current profile name is missing from profile list")
    if not len(values) == len(self.profiles[self.cur_profile]):
      raise RuntimeError('Expected {} threshold values, got {}'.format(len(self.profiles[self.cur_profile]), values))
    self.profiles[self.cur_profile] = values.copy()
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
      self.profiles[''] = [0] * self.num_sensors
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
  def __init__(self, num_sensors=4):
    self.__is_open = False
    self.__num_sensors = num_sensors
     # Use this to store the values when emulating serial so the graph isn't too
     # jumpy.
    self.__no_serial_values = [0] * self.__num_sensors
    self.__thresholds = [0] * self.__num_sensors

  def Open(self):
    self.__is_open = True

  def Close(self):
    self.__is_open = False  

  def isOpen(self):
    return self.__is_open

  def Send(self, command):
    if command == 'v\n':
      offsets = [int(normalvariate(0, self.__num_sensors + 1)) for _ in range(self.__num_sensors)]
      self.__no_serial_values = [
        max(0, min(self.__no_serial_values[i] + offsets[i], 1023))
        for i in range(self.__num_sensors)
      ]
      return 'v %s' % (' '.join(map(str, self.__no_serial_values)))
    elif command == 't\n':
      return 't %s' % (' '.join(map(str, self.__thresholds)))
    elif "0123456789".find(command[0]) != -1:
      sensor_index = int(command[0])
      self.__thresholds[sensor_index] = int(command[1:])
      return 't %s' % (' '.join(map(str, self.__thresholds)))

class CommandFormatError(Exception):
  pass

class SerialReadTimeoutError(Exception):
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
      raise SerialReadTimeoutError('Timeout reading response to command. {} {}'.format(command, line))

    return line.strip()

class FsrSerialHandler(object):
  def __init__(self, serial_handler):
    self.__serial_handler = serial_handler

  def Open(self):
    self.__serial_handler.Open()
  
  def Close(self):
    self.__serial_handler.Close()
  
  def isOpen(self):
    return self.__serial_handler.isOpen()

  async def get_values(self):
    response = await asyncio.to_thread(lambda: self.__serial_handler.Send('v\n'))
    # Expect current sensor values preceded by a 'v'.
    # v num1 num2 num3 num4
    parts = response.split()
    if parts[0] != 'v':
      raise CommandFormatError('Expected values in response, got "{}"' % (response))
    return [int(x) for x in parts[1:]]

  async def get_thresholds(self):
    response = await asyncio.to_thread(lambda: self.__serial_handler.Send('t\n'))
    # Expect current thresholds preceded by a 't'.
    # t num1 num2 num3 num4
    parts = response.split()
    if parts[0] != 't':
      raise CommandFormatError('Expected thresholds in response, got "{}"' % (response))
    return [int(x) for x in parts[1:]]  

  async def update_threshold(self, index, threshold):
    threshold_cmd = '%d %d\n' % (index, threshold)
    response = await asyncio.to_thread(lambda: self.__serial_handler.Send(threshold_cmd))
    # Expect updated thresholds preceded by a 't'.
    # t num1 num2 num3 num4
    parts = response.split()
    if parts[0] != 't':
      raise CommandFormatError('Expected thresholds in response, got "{}"' % (response))
    return [int(x) for x in parts[1:]]
  
  async def update_thresholds(self, thresholds):
    """
    Update multiple thresholds. Return the new thresholds after the final update.
    """
    for index, threshold in enumerate(thresholds):
      new_thresholds = await self.update_threshold(index, threshold)
    return new_thresholds


async def run_websockets(websocket_handler, serial_handler, defaults_handler):
  profile_handler = None

  async def update_threshold(values, index):
    thresholds = await serial_handler.update_threshold(index, values[index])
    profile_handler.UpdateThresholds(thresholds)
    await websocket_handler.broadcast_thresholds(profile_handler.GetCurThresholds())
    print('Profile is "{}". Thresholds are: {}'.format(
      profile_handler.GetCurrentProfile(), str(profile_handler.GetCurThresholds())))

  async def update_thresholds(values):
    thresholds = await serial_handler.update_thresholds(values)
    profile_handler.UpdateThresholds(thresholds)
    await websocket_handler.broadcast_thresholds(profile_handler.GetCurThresholds())
    print('Profile is "{}". Thresholds are: {}'.format(
      profile_handler.GetCurrentProfile(), str(profile_handler.GetCurThresholds())))

  async def add_profile(profile_name, thresholds):
    profile_handler.AddProfile(profile_name, thresholds)
    # When we add a profile, we are using the currently loaded thresholds so we
    # don't need to explicitly apply anything.
    await websocket_handler.broadcast_profiles(profile_handler.GetProfileNames())
    await websocket_handler.broadcast_cur_profile(profile_handler.GetCurrentProfile())
    print('Changed to new profile "{}". Thresholds are: {}'.format(
      profile_handler.GetCurrentProfile(), str(profile_handler.GetCurThresholds())))

  async def remove_profile(profile_name):
    profile_handler.RemoveProfile(profile_name)
    # Need to apply the thresholds of the profile we've fallen back to.
    thresholds = profile_handler.GetCurThresholds()
    await update_thresholds(thresholds)
    await websocket_handler.broadcast_profiles(profile_handler.GetProfileNames())
    await websocket_handler.broadcast_cur_profile(profile_handler.GetCurrentProfile())
    print('Removed profile "{}" and changed to profile "{}". Thresholds are: {}'.format(
      profile_name, profile_handler.GetCurrentProfile(), str(profile_handler.GetCurThresholds())))

  async def change_profile(profile_name):
    profile_handler.ChangeProfile(profile_name)
    # Need to apply the thresholds of the profile we've changed to.
    thresholds = profile_handler.GetCurThresholds()
    await update_thresholds(thresholds)
    await websocket_handler.broadcast_cur_profile(profile_handler.GetCurrentProfile())
    print('Changed to profile "{}". Thresholds are: {}'.format(
      profile_handler.GetCurrentProfile(), str(profile_handler.GetCurThresholds())))

  async def handle_client_message(data):
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

  while True:
    try:
      await asyncio.to_thread(lambda: serial_handler.Open())
      print('Serial connected')
      websocket_handler.serial_connected = True
      # Retrieve current thresholds on connect, and establish number of panels
      thresholds = await serial_handler.get_thresholds()
      profile_handler = ProfileHandler(num_sensors=len(thresholds))

      # Load saved profiles
      profile_handler.Load()
      print('Found Profiles: ' + str(list(profile_handler.GetProfileNames())))

      # Send current thresholds from loaded profile, then write back from MCU to profiles.
      thresholds = profile_handler.GetCurThresholds()
      thresholds = await serial_handler.update_thresholds(thresholds)
      profile_handler.UpdateThresholds(thresholds)
      print('Profile is "{}". Thresholds are: {}'.format(
        profile_handler.GetCurrentProfile(), profile_handler.GetCurThresholds()))

      # Handle GET /defaults using new profile_handler
      defaults_handler.set_profile_handler(profile_handler)
      
      # Minimum delay in seconds to wait betwen getting current sensor values
      POLL_VALUES_WAIT_SECONDS = 1.0 / 100

      # Poll sensor values and handle client message
      poll_values_task = asyncio.create_task(asyncio.sleep(POLL_VALUES_WAIT_SECONDS))
      receive_json_task = asyncio.create_task(websocket_handler.receive_json())
      while True:
        done, pending = await asyncio.wait([poll_values_task, receive_json_task], return_when=asyncio.FIRST_COMPLETED)
        for task in done:
          if task == poll_values_task:
            if websocket_handler.has_clients():
              values = await serial_handler.get_values()
              await websocket_handler.broadcast_values(values)
            poll_values_task = asyncio.create_task(asyncio.sleep(POLL_VALUES_WAIT_SECONDS))
          if task == receive_json_task:
            data = await task
            await handle_client_message(data)
            websocket_handler.task_done()
            receive_json_task = asyncio.create_task(websocket_handler.receive_json())

    except (serial.SerialException, SerialReadTimeoutError) as e:
      # In case of serial error, disconnect all clients. The WebUI will try to reconnect.
      serial_handler.Close()
      logger.exception('Serial error: %s', e)
      websocket_handler.serial_connected = False
      defaults_handler.set_profile_handler(None)
      await websocket_handler.cancel_ws_tasks()
      await asyncio.sleep(3)

class WebSocketHandler(object):
  def __init__(self):
    # Set when connecting or disconnecting serial device.
    self.serial_connected = False
    # Queue to pass messages to main Task
    self.__receive_queue = asyncio.Queue(maxsize=1)
    # Used to coordinate updates to app['websockets'] set
    self.__websockets_lock = asyncio.Lock()
    # Set of open websockets used to broadcast messages to all clients.
    self.__websockets = set()
    # Set of open websocket tasks to cancel when the app shuts down.
    self.__websocket_tasks = set()

  # Only the task that opens a websocket is allowed to call receive on it,
  # so call receive in the handler task and queue messages for other coroutines to read.
  async def receive_json(self):
    return await self.__receive_queue.get()

  # Call after processing the json from receive_json
  def task_done(self):
    self.__receive_queue.task_done()

  async def send_json_all(self, msg):
    # Iterate over copy of set in case the set is modified while awaiting a send
    websockets = self.__websockets.copy()
    for ws in websockets:
      if not ws.closed:
        await ws.send_json(msg)
  
  async def broadcast_thresholds(self, thresholds):
    """Send current thresholds to all connected clients"""
    await self.send_json_all(['thresholds', {'thresholds': thresholds}])
  
  async def broadcast_values(self, values):
    """Send current sensor values to all connected clients"""
    await self.send_json_all(['values', {'values': values}])

  async def broadcast_profiles(self, profiles):
    """Send list of profile names to all connected clients"""
    await self.send_json_all(['get_profiles', {'profiles': profiles}])

  async def broadcast_cur_profile(self, cur_profile):
    """Send name of current profile to all connected clients"""
    await self.send_json_all(['get_cur_profile', {'cur_profile': cur_profile}])

  async def cancel_ws_tasks(self):
    async with self.__websockets_lock:
      for task in self.__websocket_tasks:
        task.cancel()
  
  def has_clients(self):
    return len(self.__websockets) > 0

  # Pass to router, this coroutine will be run in one task per connection
  async def handle_ws(self, request):
    if not self.serial_connected:
      return json_response({}, status=503)

    this_task = asyncio.current_task()
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    async with self.__websockets_lock:
      self.__websockets.add(ws)
      self.__websocket_tasks.add(this_task)
    print('Client connected')

    try:
      while not ws.closed:
        msg = await ws.receive()
        if msg.type == WSMsgType.CLOSE:
          break
        elif msg.type == WSMsgType.TEXT:
          data = msg.json()
        await self.__receive_queue.put(data)
    finally:
      async with self.__websockets_lock:
        self.__websockets.remove(ws)
        self.__websocket_tasks.remove(this_task)
      await ws.close()
      print('Client disconnected')

build_dir = os.path.abspath(
  os.path.join(os.path.dirname(__file__), '..', 'build')
)

async def get_index(request):
  return web.FileResponse(os.path.join(build_dir, 'index.html'))

class DefaultsHandler(object):
  def __init__(self):
    self.__profile_handler = None

  def set_profile_handler(self, profile_handler):
    self.__profile_handler = profile_handler

  async def handle_defaults(self, request):
    if self.__profile_handler:
      return json_response({
        'profiles': self.__profile_handler.GetProfileNames(),
        'cur_profile': self.__profile_handler.GetCurrentProfile(),
        'thresholds': self.__profile_handler.GetCurThresholds()
      })
    else:
      return json_response({}, status=503)

def main():
  defaults_handler = DefaultsHandler()
  websocket_handler = WebSocketHandler()

  if NO_SERIAL:
    serial_handler = FsrSerialHandler(FakeSerialHandler())
  else:
    serial_handler = FsrSerialHandler(SerialHandler(port=SERIAL_PORT, timeout=0.05))

  async def on_startup(app):
    asyncio.create_task(run_websockets(websocket_handler=websocket_handler, serial_handler=serial_handler, defaults_handler=defaults_handler))

  async def on_shutdown(app):
    await websocket_handler.cancel_ws_tasks()

  app = web.Application()

  app.add_routes([
    web.get('/defaults', defaults_handler.handle_defaults),
    web.get('/ws', websocket_handler.handle_ws),
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
