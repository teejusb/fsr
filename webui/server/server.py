#!/usr/bin/env python
import asyncio
import logging
import os
import socket
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

class CommandFormatError(Exception):
  """Serial responded but command was not in the expected format."""

class SerialReadTimeoutError(Exception):
  """
  Serial response did not end in a newline,
  presumably because read operation timed out before receiving one.
  """

class ProfileHandler(object):
  """
  Track a list of profiles and which is the "current" one. Handle
  saving and loading profiles from a text file.
  """
  def __init__(self, num_sensors, filename='profiles.txt'):
    """
    Keyword arguments:
    num_sensors -- all profiles are expected to have this many sensors
    filename -- relative path for file safe/load profiles (default 'profiles.txt')
    """
    self._num_sensors = num_sensors
    self._filename = filename
    self._profiles = OrderedDict()
    self._cur_profile = ''
    # Have a default no-name profile we can use in case there are no profiles.
    self._profiles[''] = [0] * self._num_sensors

  def _AssertThresholdsLength(self, thresholds):
    """Raise error if thresholds list is not the expected length."""
    if not len(thresholds) == self._num_sensors:
      raise ValueError('Expected {} threshold values, got {}'.format(self._num_sensors, thresholds))

  def _Save(self):
    """
    Save profiles to file. The empty-name '' profile is always skipped.
    """
    with open(self._filename, 'w') as f:
      for name, thresholds in self._profiles.items():
        if name:
          f.write(name + ' ' + ' '.join(map(str, thresholds)) + '\n')

  def Load(self):
    """
    Load profiles from file if it exists, and change the to the first profile found.
    If no profiles are found, do not change the current profile.
    """
    num_profiles = 0
    if os.path.exists(self._filename):
      with open(self._filename, 'r') as f:
        for line in f:
          parts = line.split()
          if len(parts) == (self._num_sensors + 1):
            self._profiles[parts[0]] = [int(x) for x in parts[1:]]
            num_profiles += 1
            # Change to the first profile found.
            if num_profiles == 1:
              self.ChangeProfile(parts[0])

  def GetCurThresholds(self):
    """Return thresholds of current profile."""
    return self._profiles[self._cur_profile]

  def UpdateThreshold(self, index, value):
    """
    Update one threshold in the current profile, and save profiles to file.
    
    Keyword arguments:
    index -- threshold index to update
    value -- new threshold value
    """
    self._profiles[self._cur_profile][index] = value
    self._Save()

  def UpdateThresholds(self, values):
    """
    Update all thresholds in the current profile, and save profiles to file.
    The number of values must match the configured num_panels.
    
    Keyword arguments:
    thresholds -- list of new threshold values
    """
    self._AssertThresholdsLength(values)
    self._profiles[self._cur_profile] = values.copy()
    self._Save()

  def ChangeProfile(self, profile_name):
    """
    Change to a profile. If there is no profile by that name,
    remain on the current profile.
    """
    if profile_name in self._profiles:
      self._cur_profile = profile_name
    else:
      print("Ignoring ChangeProfile, ", profile_name, " not in ", self._profiles)

  def GetProfileNames(self):
    """
    Return list of all profile names.
    Does not include the empty-name '' profile.
    """
    return [name for name in self._profiles.keys() if name]

  def AddProfile(self, profile_name, thresholds):
    """
    If the current profile is the empty-name '' profile, reset thresholds to defaults.
    Add a profile, change to it, and save profiles to file.

    Keyword arguments:
    profile_name -- the name of the new profile
    thresholds -- list of threshold values for the new profile
    """
    self._AssertThresholdsLength(thresholds)
    self._profiles[profile_name] = thresholds
    if self._cur_profile == '':
      self._profiles[''] = [0] * self._num_sensors
    self.ChangeProfile(profile_name)
    self._Save()

  def RemoveProfile(self, profile_name):
    """
    Delete a profile and save profiles to file.
    Change to empty-name '' profile if deleted profile was the current profile.
    Trying to delete an unknown profile will print a warning and do nothing.
    """
    if not profile_name in self._profiles:
      print("No profile named ", profile_name, " to delete in ", self._profiles)
      return
    del self._profiles[profile_name]
    if profile_name == self._cur_profile:
      self.ChangeProfile('')
    self._Save()

  def GetCurrentProfile(self):
    """Return current profile name."""
    return self._cur_profile

class FakeSerialHandler(object):
  def __init__(self, num_sensors):
    self._is_open = False
    self._num_sensors = num_sensors
    # Use previous values when randomly generating sensor readings
    # so graph isn't too jumpy.
    self._sensor_values = [0] * self._num_sensors
    self._thresholds = [0] * self._num_sensors

  async def open(self):
    self._is_open = True

  def close(self):
    self._is_open = False  

  @property
  def is_open(self):
    return self._is_open

  async def get_values(self):
    offsets = [int(normalvariate(0, self._num_sensors + 1)) for _ in range(self._num_sensors)]
    self._sensor_values = [
      max(0, min(self._sensor_values[i] + offsets[i], 1023))
      for i in range(self._num_sensors)
    ]
    return self._sensor_values.copy()

  async def get_thresholds(self):
    return self._sensor_values.copy()

  async def update_threshold(self, index, threshold):
      self._thresholds[index] = threshold
      return self._thresholds.copy()
  
  async def update_thresholds(self, thresholds):
    """
    Update multiple thresholds. Return the new thresholds after the final update.
    """
    self._thresholds = thresholds.copy()
    return self._thresholds.copy()

class SyncSerialSender(object):
  """
  Send and receive serial commands one line at at time.
  """

  def __init__(self, port, timeout=1):
    """
    port: string, the path/name of the serial object to open.
    timeout: int, the time in seconds indicating the timeout for serial
      operations.
    """
    self._ser = None
    self._port = port
    self._timeout = timeout

  def open(self):
    self._ser = serial.Serial(self._port, 115200, timeout=self._timeout)

  def close(self):
    if self._ser and not self._ser.closed:
      self._ser.close()
    self._ser = None
  
  @property
  def is_open(self):
    return self._ser and self._ser.is_open

  def send(self, command):
    self._ser.write(command.encode())

    line = self._ser.readline().decode('ascii')

    if not line.endswith('\n'):
      raise SerialReadTimeoutError('Timeout reading response to command. {} {}'.format(command, line))

    return line.strip()

class SerialHandler(object):
  def __init__(self, sync_serial_sender):
    self._sync_serial_sender = sync_serial_sender

  async def open(self):
    self._sync_serial_sender.open()
  
  def close(self):
    self._sync_serial_sender.close()
  
  @property
  def is_open(self):
    return self._sync_serial_sender.is_open

  async def get_values(self):
    response = await asyncio.to_thread(lambda: self._sync_serial_sender.send('v\n'))
    # Expect current sensor values preceded by a 'v'.
    # v num1 num2 num3 num4
    parts = response.split()
    if parts[0] != 'v':
      raise CommandFormatError('Expected values in response, got "{}"' % (response))
    return [int(x) for x in parts[1:]]

  async def get_thresholds(self):
    response = await asyncio.to_thread(lambda: self._sync_serial_sender.send('t\n'))
    # Expect current thresholds preceded by a 't'.
    # t num1 num2 num3 num4
    parts = response.split()
    if parts[0] != 't':
      raise CommandFormatError('Expected thresholds in response, got "{}"' % (response))
    return [int(x) for x in parts[1:]]  

  async def update_threshold(self, index, threshold):
    threshold_cmd = '%d %d\n' % (index, threshold)
    response = await asyncio.to_thread(lambda: self._sync_serial_sender.send(threshold_cmd))
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

class WebSocketHandler(object):
  def __init__(self):
    # Set when connecting or disconnecting serial device.
    self.serial_connected = False
    # Queue to pass messages to main Task
    self._receive_queue = asyncio.Queue(maxsize=1)
    # Used to coordinate updates to app['websockets'] set
    self._websockets_lock = asyncio.Lock()
    # Set of open websockets used to broadcast messages to all clients.
    self._websockets = set()
    # Set of open websocket tasks to cancel when the app shuts down.
    self._websocket_tasks = set()

  # Only the task that opens a websocket is allowed to call receive on it,
  # so call receive in the handler task and queue messages for other coroutines to read.
  async def receive_json(self):
    return await self._receive_queue.get()

  # Call after processing the json from receive_json
  def task_done(self):
    self._receive_queue.task_done()

  async def send_json_all(self, msg):
    # Iterate over copy of set in case the set is modified while awaiting a send
    websockets = self._websockets.copy()
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
    async with self._websockets_lock:
      for task in self._websocket_tasks:
        task.cancel()
  
  @property
  def has_clients(self):
    return len(self._websockets) > 0

  # Pass to router, this coroutine will be run in one task per connection
  async def handle_ws(self, request):
    if not self.serial_connected:
      return json_response({}, status=503)

    this_task = asyncio.current_task()
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    async with self._websockets_lock:
      self._websockets.add(ws)
      self._websocket_tasks.add(this_task)
    print('Client connected')

    try:
      while not ws.closed:
        msg = await ws.receive()
        if msg.type == WSMsgType.CLOSE:
          break
        elif msg.type == WSMsgType.TEXT:
          data = msg.json()
        await self._receive_queue.put(data)
    finally:
      async with self._websockets_lock:
        self._websockets.remove(ws)
        self._websocket_tasks.remove(this_task)
      await ws.close()
      print('Client disconnected')

class DefaultsHandler(object):
  def __init__(self):
    self._profile_handler = None

  def set_profile_handler(self, profile_handler):
    self._profile_handler = profile_handler

  async def handle_defaults(self, request):
    if self._profile_handler:
      return json_response({
        'profiles': self._profile_handler.GetProfileNames(),
        'cur_profile': self._profile_handler.GetCurrentProfile(),
        'thresholds': self._profile_handler.GetCurThresholds()
      })
    else:
      return json_response({}, status=503)

async def run_main_task_loop(websocket_handler, serial_handler, defaults_handler):
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
    print('Removed profile "{}". Profile is "{}". Thresholds are: {}'.format(
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
      await serial_handler.open()
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
            if websocket_handler.has_clients:
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
      serial_handler.close()
      logger.exception('Serial error: %s', e)
      websocket_handler.serial_connected = False
      defaults_handler.set_profile_handler(None)
      await websocket_handler.cancel_ws_tasks()
      await asyncio.sleep(3)

build_dir = os.path.abspath(
  os.path.join(os.path.dirname(__file__), '..', 'build')
)

async def get_index(request):
  return web.FileResponse(os.path.join(build_dir, 'index.html'))

def main():
  defaults_handler = DefaultsHandler()
  websocket_handler = WebSocketHandler()

  if NO_SERIAL:
    serial_handler = FakeSerialHandler(num_sensors=4)
  else:
    serial_handler = SerialHandler(SyncSerialSender(port=SERIAL_PORT, timeout=0.05))

  async def on_startup(app):
    asyncio.create_task(run_main_task_loop(websocket_handler=websocket_handler, serial_handler=serial_handler, defaults_handler=defaults_handler))

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
