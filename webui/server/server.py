#!/usr/bin/env python
import asyncio
import logging
import os
import queue
import socket
import threading
import time
from collections import OrderedDict
from random import normalvariate

import serial
from aiohttp import web, WSMsgType
from aiohttp.web import json_response

logger = logging.getLogger(__name__)

# Edit this to match the serial port name shown in Arduino IDE
SERIAL_PORT = "/dev/ttyACM0"
HTTP_PORT = 5000

# Threads for the serial reader and writer.
read_thread = None
write_thread = None
thread_stop_event = threading.Event()

# L, D, U, R
sensor_numbers = [0, 1, 2, 3]

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
  def __init__(self, filename='profiles.txt'):
    self.filename = filename
    self.profiles = OrderedDict()
    self.cur_profile = ''
    # Have a default no-name profile we can use in case there are no profiles.
    self.profiles[''] = [0, 0, 0, 0]
    self.loaded = False

  def MaybeLoad(self):
    if not self.loaded:
      num_profiles = 0
      if os.path.exists(self.filename):
        with open(self.filename, 'r') as f:
          for line in f:
            parts = line.split()
            if len(parts) == 5:
              self.profiles[parts[0]] = [int(x) for x in parts[1:]]
              num_profiles += 1
              # Change to the first profile found.
              # This will also emit the thresholds.
              if num_profiles == 1:
                self.ChangeProfile(parts[0])
      else:
        open(self.filename, 'w').close()
      self.loaded = True
      print('Found Profiles: ' + str(list(self.profiles.keys())))

  def GetCurThresholds(self):
    if self.cur_profile in self.profiles:
      return self.profiles[self.cur_profile]
    else:
      # Should never get here assuming cur_profile is always appropriately
      # updated, but you never know.
      self.ChangeProfile('')
      return self.profiles[self.cur_profile]

  def UpdateThresholds(self, index, value):
    if self.cur_profile in self.profiles:
      self.profiles[self.cur_profile][index] = value
      with open(self.filename, 'w') as f:
        for name, thresholds in self.profiles.items():
          if name:
            f.write(name + ' ' + ' '.join(map(str, thresholds)) + '\n')
      broadcast(['thresholds', {'thresholds': self.GetCurThresholds()}])
      print('Thresholds are: ' + str(self.GetCurThresholds()))

  def ChangeProfile(self, profile_name):
    if profile_name in self.profiles:
      self.cur_profile = profile_name
      broadcast(['thresholds', {'thresholds': self.GetCurThresholds()}])
      broadcast(['get_cur_profile', {'cur_profile': self.GetCurrentProfile()}])
      print('Changed to profile "{}" with thresholds: {}'.format(
        self.GetCurrentProfile(), str(self.GetCurThresholds())))

  def GetProfileNames(self):
    return [name for name in self.profiles.keys() if name]

  def AddProfile(self, profile_name, thresholds):
    self.profiles[profile_name] = thresholds
    if self.cur_profile == '':
      self.profiles[''] = [0, 0, 0, 0]
    # ChangeProfile emits 'thresholds' and 'cur_profile'
    self.ChangeProfile(profile_name)
    with open(self.filename, 'w') as f:
      for name, thresholds in self.profiles.items():
        if name:
          f.write(name + ' ' + ' '.join(map(str, thresholds)) + '\n')
    broadcast(['get_profiles', {'profiles': self.GetProfileNames()}])
    print('Added profile "{}" with thresholds: {}'.format(
      self.GetCurrentProfile(), str(self.GetCurThresholds())))

  def RemoveProfile(self, profile_name):
    if profile_name in self.profiles:
      del self.profiles[profile_name]
      if profile_name == self.cur_profile:
        self.ChangeProfile('')
      with open(self.filename, 'w') as f:
        for name, thresholds in self.profiles.items():
          if name:
            f.write(name + ' ' + ' '.join(map(str, thresholds)) + '\n')
      broadcast(['get_profiles', {'profiles': self.GetProfileNames()}])
      broadcast(['thresholds', {'thresholds': self.GetCurThresholds()}])
      broadcast(['get_cur_profile', {'cur_profile': self.GetCurrentProfile()}])
      print('Removed profile "{}". Current thresholds are: {}'.format(
        profile_name, str(self.GetCurThresholds())))

  def GetCurrentProfile(self):
    return self.cur_profile


class SerialHandler(object):
  """
  A class to handle all the serial interactions.

  Attributes:
    ser: Serial, the serial object opened by this class.
    port: string, the path/name of the serial object to open.
    timeout: int, the time in seconds indicating the timeout for serial
      operations.
    write_queue: Queue, a queue object read by the writer thread
    profile_handler: ProfileHandler, the global profile_handler used to update
      the thresholds
  """
  def __init__(self, profile_handler, port='', timeout=1):
    self.ser = None
    self.port = port
    self.timeout = timeout
    self.write_queue = queue.Queue(10)
    self.profile_handler = profile_handler

    # Use this to store the values when emulating serial so the graph isn't too
    # jumpy. Only used when NO_SERIAL is true.
    self.no_serial_values = [0, 0, 0, 0]

  def ChangePort(self, port):
    if self.ser:
      self.ser.close()
      self.ser = None
    self.port = port
    self.Open()

  def Open(self):
    if not self.port:
      return

    if self.ser:
      self.ser.close()
      self.ser = None

    try:
      self.ser = serial.Serial(self.port, 115200, timeout=self.timeout)
      if self.ser:
        # Apply currently loaded thresholds when the microcontroller connects.
        for i, threshold in enumerate(self.profile_handler.GetCurThresholds()):
          threshold_cmd = str(sensor_numbers[i]) + str(threshold) + '\n'
          self.write_queue.put(threshold_cmd, block=False)
    except queue.Full as e:
      logger.error('Could not set thresholds. Queue full.')
    except serial.SerialException as e:
      self.ser = None
      logger.exception('Error opening serial: %s', e)

  def Read(self):
    def ProcessValues(values):
      # Fix our sensor ordering.
      actual = []
      for i in range(4):
        actual.append(values[sensor_numbers[i]])
      broadcast(['values', {'values': actual}])
      time.sleep(0.01)

    def ProcessThresholds(values):
      cur_thresholds = self.profile_handler.GetCurThresholds()
      # Fix our sensor ordering.
      actual = []
      for i in range(4):
        actual.append(values[sensor_numbers[i]])
      for i, (cur, act) in enumerate(zip(cur_thresholds, actual)):
        if cur != act:
          self.profile_handler.UpdateThresholds(i, act)

    while not thread_stop_event.isSet():
      if NO_SERIAL:
        offsets = [int(normalvariate(0, 5)) for _ in range(4)]
        self.no_serial_values = [
          max(0, min(self.no_serial_values[i] + offsets[i], 1023))
          for i in range(4)
        ]
        broadcast(['values', {'values': self.no_serial_values}])
        time.sleep(0.01)
      else:
        if not self.ser:
          self.Open()
          # Still not open, retry loop.
          if not self.ser:
            continue

        try:
          # Send the command to fetch the values.
          self.write_queue.put('v\n', block=False)

          # Wait until we actually get the values.
          # This will block the thread until it gets a newline
          line = self.ser.readline().decode('ascii').strip()

          # All commands are of the form:
          #   cmd num1 num2 num3 num4
          parts = line.split()
          if len(parts) != 5:
            continue
          cmd = parts[0]
          values = [int(x) for x in parts[1:]]

          if cmd == 'v':
            ProcessValues(values)
          elif cmd == 't':
            ProcessThresholds(values)
        except queue.Full as e:
          logger.error('Could not fetch new values. Queue full.')
        except serial.SerialException as e:
          logger.error('Error reading data: ', e)
          self.Open()

  def Write(self):
    while not thread_stop_event.isSet():
      command = self.write_queue.get()
      if NO_SERIAL:
        if command[0] == 't':
          broadcast(['thresholds',
            {'thresholds': self.profile_handler.GetCurThresholds()}])
          print('Thresholds are: ' +
            str(self.profile_handler.GetCurThresholds()))
        else:
          sensor, threshold = int(command[0]), int(command[1:-1])
          for i, index in enumerate(sensor_numbers):
            if index == sensor:
              self.profile_handler.UpdateThresholds(i, threshold)
      else:
        if not self.ser:
          # Just wait until the reader opens the serial port.
          time.sleep(1)
          continue

        try:
          self.ser.write(command.encode())
        except serial.SerialException as e:
          logger.error('Error writing data: ', e)
          # Emit current thresholds since we couldn't update the values.
          broadcast(['thresholds',
            {'thresholds': self.profile_handler.GetCurThresholds()}])


profile_handler = ProfileHandler()
serial_handler = SerialHandler(profile_handler, port=SERIAL_PORT)


def update_threshold(values, index):
  try:
    # Let the writer thread handle updating thresholds.
    threshold_cmd = str(sensor_numbers[index]) + str(values[index]) + '\n'
    serial_handler.write_queue.put(threshold_cmd, block=False)
  except queue.Full:
    logger.error('Could not update thresholds. Queue full.')


def add_profile(profile_name, thresholds):
  profile_handler.AddProfile(profile_name, thresholds)
  # When we add a profile, we are using the currently loaded thresholds so we
  # don't need to explicitly apply anything.


def remove_profile(profile_name):
  profile_handler.RemoveProfile(profile_name)
  # Need to apply the thresholds of the profile we've fallen back to.
  thresholds = profile_handler.GetCurThresholds()
  for i in range(len(thresholds)):
    update_threshold(thresholds, i)


def change_profile(profile_name):
  profile_handler.ChangeProfile(profile_name)
  # Need to apply the thresholds of the profile we've changed to.
  thresholds = profile_handler.GetCurThresholds()
  for i in range(len(thresholds)):
    update_threshold(thresholds, i)


async def get_defaults(request):
  return json_response({
    'profiles': profile_handler.GetProfileNames(),
    'cur_profile': profile_handler.GetCurrentProfile(),
    'thresholds': profile_handler.GetCurThresholds()
  })


out_queues = set()
out_queues_lock = threading.Lock()
main_thread_loop = asyncio.get_event_loop()


def broadcast(msg):
  with out_queues_lock:
    for q in out_queues:
      try:
        main_thread_loop.call_soon_threadsafe(q.put_nowait, msg)
      except asyncio.queues.QueueFull:
        pass


async def get_ws(request):
  ws = web.WebSocketResponse()
  await ws.prepare(request)

  print('Client connected')
  profile_handler.MaybeLoad()

  # The above does emit if there are differences, so have an extra for the
  # case there are no differences.
  await ws.send_json([
    'thresholds',
    {'thresholds': profile_handler.GetCurThresholds()},
  ])

  global read_thread, write_thread

  if not read_thread or not read_thread.is_alive():
    print('Starting Read thread')
    read_thread = threading.Thread(target=serial_handler.Read)
    read_thread.daemon = True
    read_thread.start()

  if not write_thread or not write_thread.is_alive():
    print('Starting Write thread')
    write_thread = threading.Thread(target=serial_handler.Write)
    write_thread.daemon = True
    write_thread.start()

  # Potentially fetch any threshold values from the microcontroller that
  # may be out of sync with our profiles.
  serial_handler.write_queue.put('t\n', block=False)

  queue = asyncio.Queue(maxsize=100)
  with out_queues_lock:
    out_queues.add(queue)

  try:
    queue_task = asyncio.create_task(queue.get())
    receive_task = asyncio.create_task(ws.receive())
    connected = True

    while connected:
      done, pending = await asyncio.wait([
        queue_task,
        receive_task,
      ], return_when=asyncio.FIRST_COMPLETED)

      for task in done:
        if task == queue_task:
          msg = await queue_task
          await ws.send_json(msg)

          queue_task = asyncio.create_task(queue.get())
        elif task == receive_task:
          msg = await receive_task

          if msg.type == WSMsgType.TEXT:
            data = msg.json()
            action = data[0]

            if action == 'update_threshold':
              values, index = data[1:]
              update_threshold(values, index)
            elif action == 'add_profile':
              profile_name, thresholds = data[1:]
              add_profile(profile_name, thresholds)
            elif action == 'remove_profile':
              profile_name, = data[1:]
              remove_profile(profile_name)
            elif action == 'change_profile':
              profile_name, = data[1:]
              change_profile(profile_name)
          elif msg.type == WSMsgType.CLOSE:
            connected = False
            continue

          receive_task = asyncio.create_task(ws.receive())
  except ConnectionResetError:
    pass
  finally:
    with out_queues_lock:
      out_queues.remove(queue)

  queue_task.cancel()
  receive_task.cancel()

  print('Client disconnected')


build_dir = os.path.abspath(
  os.path.join(os.path.dirname(__file__), '..', 'build')
)


async def get_index(request):
  return web.FileResponse(os.path.join(build_dir, 'index.html'))


app = web.Application()
app.add_routes([
  web.get('/defaults', get_defaults),
  web.get('/ws', get_ws),
])
if not NO_SERIAL:
  app.add_routes([
    web.get('/', get_index),
    web.get('/plot', get_index),
    web.static('/', build_dir),
  ])


if __name__ == '__main__':
  hostname = socket.gethostname()
  ip_address = socket.gethostbyname(hostname)
  print(' * WebUI can be found at: http://' + ip_address + ':' + str(HTTP_PORT))

  web.run_app(app, port=HTTP_PORT)
