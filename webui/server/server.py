#!/usr/bin/env python
import asyncio
import logging
import os
import socket
import sys
import threading
from collections import OrderedDict
from random import normalvariate

import serial
from aiohttp import web, WSMsgType
from aiohttp.web import json_response

logger = logging.getLogger(__name__)

# Edit this to match the serial port name shown in Arduino IDE
SERIAL_PORT = "/dev/ttyACM0"
HTTP_PORT = 5000

# Event to tell the serial thread to exit.
thread_stop_event = threading.Event()

# Amount of panels.
num_panels = 4

# Initialize panel ids.
sensor_numbers = range(num_panels)

# Used for developmental purposes. Set this to true when you just want to
# emulate the serial device instead of actually connecting to one.
NO_SERIAL = False

# Queue for broadcasting sensor values
out_queue = asyncio.Queue(maxsize=1)

# Queue for 
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

async def run_fake_serial(write_queue, profile_handler):
  # Use this to store the values when emulating serial so the graph isn't too
  # jumpy. Only used when NO_SERIAL is true.
  no_serial_values = [0] * num_panels

  while not thread_stop_event.is_set():
    # Check for command from write_queue
    try:
      # The timeout here controls the frequency of checking sensor values.
      command = await asyncio.wait_for(write_queue.get(), timeout=0.01)
    except asyncio.TimeoutError:
      # If there is no other pending command, check sensor values.
      command = 'v\n'
    if command == 'v\n':
      offsets = [int(normalvariate(0, num_panels+1)) for _ in range(num_panels)]
      no_serial_values = [
        max(0, min(no_serial_values[i] + offsets[i], 1023))
        for i in range(num_panels)
      ]
      # broadcast(['values', {'values': no_serial_values}])
      out_queue.put_nowait(['values', {'values': no_serial_values}])
    # elif command == 't\n':
    #   if command[0] == 't':
    #     broadcast(['thresholds',
    #       {'thresholds': profile_handler.GetCurThresholds()}])
    #     print('Thresholds are: ' +
    #       str(profile_handler.GetCurThresholds()))


async def run_serial(port, timeout, write_queue, profile_handler):
  """
  A function to handle all the serial interactions. Run in a separate Task.

  Parameters:
    port: string, the path/name of the serial object to open.
    timeout: int, the time in seconds indicating the timeout for serial
      operations.
    write_queue: asyncio queue of serial writes
    profile_handler: ProfileHandler, the global profile_handler used to update
      the thresholds
  """
  ser = None

  async def ProcessValues(values):
    # Fix our sensor ordering.
    actual = []
    for i in range(num_panels):
      actual.append(values[sensor_numbers[i]])
    try:
      out_queue.put_nowait(['values', {'values': actual}])
    except asyncio.QueueFull:
      print('queue full')

  def ProcessThresholds(values):
    cur_thresholds = profile_handler.GetCurThresholds()
    # Fix our sensor ordering.
    actual = []
    for i in range(num_panels):
      actual.append(values[sensor_numbers[i]])
    for i, (cur, act) in enumerate(zip(cur_thresholds, actual)):
      if cur != act:
        profile_handler.UpdateThresholds(i, act)

  while not thread_stop_event.is_set():
    # Try to open the serial port if needed
    if not ser:
      try:
        def open_serial():
          return serial.Serial(port, 115200, timeout=timeout)
        ser = await asyncio.to_thread(open_serial)
      except serial.SerialException as e:
        ser = None
        logger.exception('Error opening serial: %s', e)
        # Delay and retry
        await asyncio.sleep(1)
        continue
    # Check for command from write_queue
    try:
      # The timeout here controls the frequency of checking sensor values.
      command = await asyncio.wait_for(write_queue.get(), timeout=0.01)
    except asyncio.TimeoutError:
      # If there is no other pending command, check sensor values.
      command = 'v\n'
    try:
      def write_command():
        ser.write(command.encode())
      await asyncio.to_thread(write_command)
    except serial.SerialException as e:
      logger.error('Error writing data: ', e)
      # Maybe we need to surface the error higher up?
      continue
    try:
      # Wait for a response.
      # This will block the thread until it gets a newline or until the serial timeout.
      def read_line():
        return ser.readline().decode('ascii')
      line = await asyncio.to_thread(read_line)

      if not line.endswith("\n"):
        logger.error('Timeout reading response to command.', command, line)
        continue

      line = line.strip()

      # All commands are of the form:
      #   cmd num1 num2 num3 num4
      parts = line.split()
      if len(parts) != num_panels+1:
        continue
      cmd = parts[0]
      values = [int(x) for x in parts[1:]]

      if cmd == 'v':
        await ProcessValues(values)
      # elif cmd == 't':
      #   ProcessThresholds(values)
    except serial.SerialException as e:
      logger.error('Error reading data: ', e)

async def run_websockets(app, write_queue, profile_handler):
  async def send_json_all(msg):
    websockets = app['websockets'].copy()
    for ws in websockets:
      if not ws.closed:
        await ws.send_json(msg)

  async def update_threshold(values, index):
    profile_handler.UpdateThresholds(index, values[index])
    try:
      threshold_cmd = str(sensor_numbers[index]) + str(values[index]) + '\n'
      await asyncio.wait_for(write_queue.put(threshold_cmd), timeout=0.1)
    except asyncio.TimeoutError:
      logger.error('Could not update thresholds. Queue full.')
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

  try:
    out_queue_task = asyncio.create_task(out_queue.get())
    receive_queue_task = asyncio.create_task(receive_queue.get())
    while True:
      done, pending = await asyncio.wait([out_queue_task, receive_queue_task], return_when=asyncio.FIRST_COMPLETED)

      for task in done:
        if task == out_queue_task:
          msg = await task
          await send_json_all(msg)
          out_queue.task_done()
          out_queue_task = asyncio.create_task(out_queue.get())
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
  except RuntimeError:
    sys.exit(1)

def make_get_defaults(profile_handler):
  async def get_defaults(request):
    return json_response({
      'profiles': profile_handler.GetProfileNames(),
      'cur_profile': profile_handler.GetCurrentProfile(),
      'thresholds': profile_handler.GetCurThresholds()
    })
  return get_defaults

async def get_ws(request):
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
      print("putting", data)
      await receive_queue.put(data)
  finally:
    async with websockets_lock:
      request.app['websockets'].remove(ws)
      request.app['websocket-tasks'].remove(this_task)
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
  thread_stop_event.set()

def main():
  profile_handler = ProfileHandler()
  profile_handler.Load()
  write_queue = asyncio.Queue(10)

  async def on_startup(app):
    if NO_SERIAL:
      asyncio.create_task(run_fake_serial(write_queue=write_queue, profile_handler=profile_handler))
    else:
      asyncio.create_task(run_serial(port=SERIAL_PORT, timeout=0.05, write_queue=write_queue, profile_handler=profile_handler))

    asyncio.create_task(run_websockets(app=app, write_queue=write_queue, profile_handler=profile_handler))

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
