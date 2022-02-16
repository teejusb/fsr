#!/usr/bin/env python
import asyncio
import logging
import os
import socket
from collections import OrderedDict
from random import normalvariate

import serial
from aiohttp import web, WSCloseCode, WSMsgType
from aiohttp.web import json_response

logger = logging.getLogger(__name__)

# Edit this to match the serial port name shown in Arduino IDE
SERIAL_PORT = "/dev/ttyACM0"
HTTP_PORT = 5000

# Used for developmental purposes. Set this to true when you just want to
# emulate the serial device instead of actually connecting to one.
NO_SERIAL = False

# Serve the index and assets for the Web UI.
# If False, only serve the websocket and JSON endpoints.
SERVE_STATIC_FRONTEND_FILES = True

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

  def _assert_thresholds_length(self, thresholds):
    """Raise error if thresholds list is not the expected length."""
    if not len(thresholds) == self._num_sensors:
      raise ValueError('Expected {} threshold values, got {}'.format(self._num_sensors, thresholds))

  def _save(self):
    """
    Save profiles to file. The empty-name '' profile is always skipped.
    """
    with open(self._filename, 'w') as f:
      for name, thresholds in self._profiles.items():
        if name:
          f.write(name + ' ' + ' '.join(map(str, thresholds)) + '\n')

  def load(self):
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
              self.change_profile(parts[0])

  def get_cur_thresholds(self):
    """Return thresholds of current profile."""
    return self._profiles[self._cur_profile]

  def update_threshold(self, index, value):
    """
    Update one threshold in the current profile, and save profiles to file.
    
    Keyword arguments:
    index -- threshold index to update
    value -- new threshold value
    """
    self._profiles[self._cur_profile][index] = value
    self._save()

  def update_thresholds(self, values):
    """
    Update all thresholds in the current profile, and save profiles to file.
    The number of values must match the configured num_panels.
    
    Keyword arguments:
    thresholds -- list of new threshold values
    """
    self._assert_thresholds_length(values)
    self._profiles[self._cur_profile] = values.copy()
    self._save()

  def change_profile(self, profile_name):
    """
    Change to a profile. If there is no profile by that name,
    remain on the current profile.
    """
    if profile_name in self._profiles:
      self._cur_profile = profile_name
    else:
      print("Ignoring ChangeProfile, ", profile_name, " not in ", self._profiles)

  def get_profile_names(self):
    """
    Return list of all profile names.
    Does not include the empty-name '' profile.
    """
    return [name for name in self._profiles.keys() if name]

  def add_profile(self, profile_name, thresholds):
    """
    If the current profile is the empty-name '' profile, reset thresholds to defaults.
    Add a profile, change to it, and save profiles to file.

    Keyword arguments:
    profile_name -- the name of the new profile
    thresholds -- list of threshold values for the new profile
    """
    self._assert_thresholds_length(thresholds)
    self._profiles[profile_name] = thresholds
    if self._cur_profile == '':
      self._profiles[''] = [0] * self._num_sensors
    self.change_profile(profile_name)
    self._save()

  def remove_profile(self, profile_name):
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
      self.change_profile('')
    self._save()

  def get_current_profile(self):
    """Return current profile name."""
    return self._cur_profile

class FakeSerialHandler(object):
  """
  Use in place of SerialHandler to test without a real serial device.
  Stores and returns thresholds as requested.
  Returns random sensor values on each read. The previous sensor values
  influence the next read so the graph isn't too jumpy.
  """
  def __init__(self, num_sensors):
    """
    Keyword arguments:
    num_sensors -- return this many values and thresholds
    """
    self._is_open = False
    self._num_sensors = num_sensors
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
    for i, threshold in enumerate(thresholds):
      self._thresholds[i] = threshold
    return self._thresholds.copy()

class SyncSerialSender(object):
  """
  Send and receive serial commands one line at at time.
  """
  def __init__(self, port, timeout=1.0):
    """
    port -- string, the path/name of the serial object to open
    timeout -- the time in seconds indicating the timeout for serial
      operations (default 1.0)
    """
    self._ser = None
    self._port = port
    self._timeout = timeout

  def open(self):
    """
    Open a new Serial instance with configured port and timeout.
    """
    self._ser = serial.Serial(self._port, 115200, timeout=self._timeout)

  def close(self):
    """
    Close the serial port if it is open.
    Does nothing if port is already closed.
    """
    if self._ser and not self._ser.closed:
      self._ser.close()
    self._ser = None
  
  @property
  def is_open(self):
    "Return True if serial port is open, false otherwise."
    return self._ser and self._ser.is_open

  def send(self, command):
    """
    Write a command string, then read a response and return it as a string.

    This does blocking IO, so don't call it directly from a coroutine.

    Command and response are both expected to end with a newline character.
    `send` does not add a newline to `command`. It does strip the newline from
    the response.

    Raises SerialReadTimeoutError if there is no response before the configured
    timeout.

    Keyword arguments:
    command -- string to write to serial port
    """
    self._ser.write(command.encode())

    line = self._ser.readline().decode('ascii')

    # If readline does not find a newline character before the Serial
    # instance's configured timeout, it will return whatever it has
    # read so far. PySerial does not throw an exception, but we will.
    if not line.endswith('\n'):
      raise SerialReadTimeoutError('Timeout reading response to command. {} {}'.format(command, line))

    return line.strip()

class SerialHandler(object):
  """
  Handle communication with the serial device.

  Provide async wrappers and command parsing on top of
  SyncSerialSender's blocking string-based IO.

  Blocking IO is run in a thread pool using an asyncio helper. However, only
  one coroutine is expected to be sending commands, one command at a time.
  There is only one underlying hardware device, so any command needs to wait
  for the previous command and response to be processed.
  """
  def __init__(self, sync_serial_sender):
    """
    Keyword arguments:
    sync_serial_sender -- SyncSerialSender instance to perform blocking reads
      and writes of command strings
    """
    self._sync_serial_sender = sync_serial_sender

  async def open(self):
    self._sync_serial_sender.open()
  
  def close(self):
    self._sync_serial_sender.close()
  
  @property
  def is_open(self):
    return self._sync_serial_sender.is_open

  async def get_values(self):
    """
    Read current sensor values from serial device and return as a list of ints.
    """
    response = await asyncio.to_thread(lambda: self._sync_serial_sender.send('v\n'))
    # Expect current sensor values preceded by a 'v'.
    # v num1 num2 num3 num4
    parts = response.split()
    if parts[0] != 'v':
      raise CommandFormatError('Expected values in response, got "{}"' % (response))
    return [int(x) for x in parts[1:]]

  async def get_thresholds(self):
    """
    Read current threshold values from serial device and return as a list of ints.
    """
    response = await asyncio.to_thread(lambda: self._sync_serial_sender.send('t\n'))
    # Expect current thresholds preceded by a 't'.
    # t num1 num2 num3 num4
    parts = response.split()
    if parts[0] != 't':
      raise CommandFormatError('Expected thresholds in response, got "{}"' % (response))
    return [int(x) for x in parts[1:]]  

  async def update_threshold(self, index, threshold):
    """
    Write a single threshold update command.
    Read all current threshold values from serial device and return as a list of ints.

    Keyword arguments:
    index -- index starting from 0 of the threshold to update
    threshold -- new threshold value
    """
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
    Send a series of commands to the serial device to update all thresholds,
    one at a time.
    Read all current threshold values from serial device after final update
    and return as a list of ints.

    Keyword arguments:
    thresholds -- list of thresholds as ints to update. The index of the list
      maps to the index of the thresholds, so index 0 will update threshold 0
      and so on
    """
    for index, threshold in enumerate(thresholds):
      new_thresholds = await self.update_threshold(index, threshold)
    return new_thresholds

class WebSocketHandler(object):
  """
  Handle websocket connections to communicate with the WebUI.

  The design of this class is based on the assumptions that all
  connected clients should be kept in sync. Messages received from any
  client are placed in the same single queue, and outgoing messages
  are sent to every connected client.
  """
  def __init__(self):
    # Set when connecting or disconnecting serial device.
    self._serial_connected = False
    # Queue to pass messages to main Task
    self._receive_queue = asyncio.Queue(maxsize=1)
    # Set of open websockets used to broadcast messages to all clients,
    # and to close in case of errors or shutdown.
    self._websockets = set()

  @property
  def serial_connected(self):
    return self._serial_connected
  
  @serial_connected.setter
  def serial_connected(self, serial_connected):
    """
    Set to True or False when serial connects or disconnects, so that
    websocket requests can return 503 service unavailable if serial
    is not connected.
    """
    self._serial_connected = serial_connected

  async def receive_json(self):
    """
    Receive the next available client message from any client.
    Messages are filtered to only WSMsgType.TEXT and already
    parsed as JSON.
    """
    return await self._receive_queue.get()

  # Call after processing the json from receive_json.
  # See documentation for ideas on how to use. At the time of this writing,
  # there is no code caling _receive_queue.join() but I thought it might come
  # in handy later. -Josh
  # https://docs.python.org/3/library/asyncio-queue.html#asyncio.Queue.task_done
  def task_done(self):
    self._receive_queue.task_done()

  async def send_json_all(self, msg):
    """
    Serialize msg as JSON and wait to send it to every connected client.
    """
    # Iterate over copy of set in case the set is modified while awaiting
    websockets = self._websockets.copy()
    for ws in websockets:
      if not ws.closed:
        await ws.send_json(msg)
  
  async def broadcast_thresholds(self, thresholds):
    """
    Send current thresholds to all connected clients
    
    Keyword arguments:
    thresholds -- threshold values as list of ints
    """
    await self.send_json_all(['thresholds', {'thresholds': thresholds}])
  
  async def broadcast_values(self, values):
    """
    Send current sensor values to all connected clients

    Keyword arguments:
    values -- sensor values as a list of ints
    """
    await self.send_json_all(['values', {'values': values}])

  async def broadcast_profiles(self, profiles):
    """
    Send list of profile names to all connected clients

    Keyword arguments:
    profiles -- list of profile names
    """
    await self.send_json_all(['get_profiles', {'profiles': profiles}])

  async def broadcast_cur_profile(self, cur_profile):
    """
    Send name of current profile to all connected clients

    Keyword arguments:
    cur_profile -- current profile name
    """
    await self.send_json_all(['get_cur_profile', {'cur_profile': cur_profile}])

  async def close_websockets(self, code=WSCloseCode.OK, message=b''):
    """
    Close all open websockets.

    code and message arguments are passed to each close() call, see
    https://docs.aiohttp.org/en/stable/web_reference.html#aiohttp.web.WebSocketResponse.close

    Keyword arguments:
    code -- closing code (default WSCloseCode.OK)
    message -- optional payload of close message, str (converted to UTF-8 encoded bytes) or bytes.
    """
    # Iterate over copy of set in case the set is modified while awaiting
    websockets = self._websockets.copy()
    for ws in websockets:
      await ws.close(code=code, message=message)

  @property
  def has_clients(self):
    """
    Return True if any clients are connected.
    """
    return len(self._websockets) > 0

  async def handle_ws(self, request):
    """
    aiohttp route handling function. Use with router, which will start one
    asyncio task per connection using this coroutine.

    Return error 503 without opening websocket if serial is not connected.

    Open websocket and add it to a set of open websockets, used to broadcast
    messages from the main task loop (using the `broadcast_*` methods of this
    class).

    Receive client messages from this websocket connection in the main task
    loop with the `receive_json` method of this class.
    """
    if not self.serial_connected:
      return json_response({}, status=503)

    ws = web.WebSocketResponse()
    await ws.prepare(request)

    self._websockets.add(ws)
    print('Client connected')

    # Only the request handling task that opens a websocket is allowed to call
    # `receive` on it, so call receive here and queue message data for another
    # task to read.
    # https://docs.aiohttp.org/en/stable/web_reference.html#aiohttp.web.WebSocketResponse.receive
    try:
      while not ws.closed:
        msg = await ws.receive()
        if msg.type == WSMsgType.CLOSING:
          break
        elif msg.type == WSMsgType.TEXT:
          data = msg.json()
          await self._receive_queue.put(data)
    finally:
      self._websockets.remove(ws)
      await ws.close()
      print('Client disconnected')

class DefaultsHandler(object):
  """
  Handle the /defaults route.
  """
  def __init__(self):
    # Don't write to the profile handler from this class.
    # Only the main task loop should be be updating it.
    self._profile_handler = None

  def set_profile_handler(self, profile_handler):
    """
    Set a ProfileHandler instance here, or set to None to clear it.
    """
    self._profile_handler = profile_handler

  async def handle_defaults(self, request):
    """
    Return an initial set of values for the WebUI to use for setup before
    connecting to the websocket.
    """
    if self._profile_handler:
      return json_response({
        'profiles': self._profile_handler.get_profile_names(),
        'cur_profile': self._profile_handler.get_current_profile(),
        'thresholds': self._profile_handler.get_cur_thresholds()
      })
    else:
      return json_response({}, status=503)

async def run_main_task_loop(websocket_handler, serial_handler, defaults_handler):
  """
  Connect to a serial device and poll it for sensor values.
  Handle incoming commands from WebUI clients.

  Disconnect clients and retry serial connection in case of serial errors.

  Keyword arguments:
    websocket_handler -- Should be the same instance that the aiohttp server is using
      handle requests. Used for receiving messages from any client and broadcasting
      messages to all clients.
    serial_handler -- Preconfigured with port and timeout, not expected to be open
      initially.
    defaults_handler -- Should be the same instance that the aiohttp server is using
      to handle requests. The main task loop creates a ProfileHandler instance and
      shares it with defaults_handler when it's ready.
  """
  profile_handler = None

  async def update_threshold(values, index):
    thresholds = await serial_handler.update_threshold(index, values[index])
    profile_handler.update_thresholds(thresholds)
    await websocket_handler.broadcast_thresholds(profile_handler.get_cur_thresholds())
    print('Profile is "{}". Thresholds are: {}'.format(
      profile_handler.get_current_profile(), str(profile_handler.get_cur_thresholds())))

  async def update_thresholds(values):
    thresholds = await serial_handler.update_thresholds(values)
    profile_handler.update_thresholds(thresholds)
    await websocket_handler.broadcast_thresholds(profile_handler.get_cur_thresholds())
    print('Profile is "{}". Thresholds are: {}'.format(
      profile_handler.get_current_profile(), str(profile_handler.get_cur_thresholds())))

  async def add_profile(profile_name, thresholds):
    profile_handler.add_profile(profile_name, thresholds)
    # When we add a profile, we are using the currently loaded thresholds so we
    # don't need to explicitly apply anything.
    await websocket_handler.broadcast_profiles(profile_handler.get_profile_names())
    await websocket_handler.broadcast_cur_profile(profile_handler.get_current_profile())
    print('Changed to new profile "{}". Thresholds are: {}'.format(
      profile_handler.get_current_profile(), str(profile_handler.get_cur_thresholds())))

  async def remove_profile(profile_name):
    profile_handler.remove_profile(profile_name)
    # Need to apply the thresholds of the profile we've fallen back to.
    thresholds = profile_handler.get_cur_thresholds()
    await update_thresholds(thresholds)
    await websocket_handler.broadcast_profiles(profile_handler.get_profile_names())
    await websocket_handler.broadcast_cur_profile(profile_handler.get_current_profile())
    print('Removed profile "{}". Profile is "{}". Thresholds are: {}'.format(
      profile_name, profile_handler.get_current_profile(), str(profile_handler.get_cur_thresholds())))

  async def change_profile(profile_name):
    profile_handler.change_profile(profile_name)
    # Need to apply the thresholds of the profile we've changed to.
    thresholds = profile_handler.get_cur_thresholds()
    await update_thresholds(thresholds)
    await websocket_handler.broadcast_cur_profile(profile_handler.get_current_profile())
    print('Changed to profile "{}". Thresholds are: {}'.format(
      profile_handler.get_current_profile(), str(profile_handler.get_cur_thresholds())))

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
      profile_handler.load()
      print('Found Profiles: ' + str(list(profile_handler.get_profile_names())))

      # Send current thresholds from loaded profile, then write back from MCU to profiles.
      thresholds = profile_handler.get_cur_thresholds()
      thresholds = await serial_handler.update_thresholds(thresholds)
      profile_handler.update_thresholds(thresholds)
      print('Profile is "{}". Thresholds are: {}'.format(
        profile_handler.get_current_profile(), profile_handler.get_cur_thresholds()))

      # Handle GET /defaults using new profile_handler
      defaults_handler.set_profile_handler(profile_handler)
      
      # Minimum delay in seconds to wait betwen getting current sensor values
      poll_values_wait_seconds = 1.0 / 100

      # Poll sensor values and handle client message
      poll_values_task = asyncio.create_task(asyncio.sleep(poll_values_wait_seconds))
      receive_json_task = asyncio.create_task(websocket_handler.receive_json())
      while True:
        done, pending = await asyncio.wait([poll_values_task, receive_json_task], return_when=asyncio.FIRST_COMPLETED)
        for task in done:
          if task == poll_values_task:
            if websocket_handler.has_clients:
              values = await serial_handler.get_values()
              await websocket_handler.broadcast_values(values)
            poll_values_task = asyncio.create_task(asyncio.sleep(poll_values_wait_seconds))
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
      await websocket_handler.close_websockets(code=WSCloseCode.INTERNAL_ERROR, message='Serial error')
      await asyncio.sleep(3)

def main():
  """Set up and run the http server."""
  defaults_handler = DefaultsHandler()
  websocket_handler = WebSocketHandler()

  build_dir = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', 'build')
  )

  if NO_SERIAL:
    serial_handler = FakeSerialHandler(num_sensors=4)
  else:
    serial_handler = SerialHandler(SyncSerialSender(port=SERIAL_PORT, timeout=0.05))

  async def on_startup(app):
    asyncio.create_task(run_main_task_loop(websocket_handler=websocket_handler,
                                           serial_handler=serial_handler,
                                           defaults_handler=defaults_handler))

  async def on_shutdown(app):
    await websocket_handler.close_websockets(code=WSCloseCode.GOING_AWAY, message='Server shutdown')

  async def get_index(request):
    return web.FileResponse(os.path.join(build_dir, 'index.html'))

  app = web.Application()
  app.add_routes([
    web.get('/defaults', defaults_handler.handle_defaults),
    web.get('/ws', websocket_handler.handle_ws),
  ])
  if SERVE_STATIC_FRONTEND_FILES:
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
