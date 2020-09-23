import logging
import queue
import serial
import socket
import time

from collections import OrderedDict
from flask import Flask
from flask_socketio import SocketIO, emit
from random import normalvariate, randint
from threading import Thread, Event

app = Flask(__name__, static_folder='../build', static_url_path='/')
socketio = SocketIO(app, cors_allowed_origins="*")

logging.getLogger('werkzeug').setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

# Threads for the serial reader and writer.
read_thread = Thread()
write_thread = Thread()
thread_stop_event = Event()

# L, D, U, R
sensor_numbers = [3, 2, 0, 1]

hostname = socket.gethostname()
ip_address = socket.gethostbyname(hostname)
print(" * WebUI can be found at: http://" + ip_address + ":5000")


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
  def __init__(self, filename="profiles.txt"):
    self.filename = filename
    self.profiles = OrderedDict()
    self.cur_profile = ""
    # Have a default no-name profile we can use in case there are no profiles.
    self.profiles[""] = [0, 0, 0, 0]
    self.loaded = False

  def MaybeLoad(self):
    if not self.loaded:
      with open(self.filename, "r") as f:
        for line in f:
          parts = line.split()
          if len(parts) == 5:
            if len(self.profiles) == 0:
              self.cur_profile = parts[0]
            self.profiles[parts[0]] = [int(x) for x in parts[1:]]
      self.loaded = True
      print("Found Profiles: " + str(list(self.profiles.keys())))

  def GetCurThresholds(self):
    if self.cur_profile in self.profiles:
      return self.profiles[self.cur_profile]
    else:
      # Should never get here assuming cur_profile is always appropriately
      # updated, but you never know.
      self.ChangeProfile("")
      return self.profiles[self.cur_profile]

  def UpdateThresholds(self, index, value):
    if self.cur_profile in self.profiles:
      self.profiles[self.cur_profile][index] = value
      with open(self.filename, "w") as f:
        for name, thresholds in self.profiles.items():
          if name:
            f.write(name + " " + " ".join(map(str, thresholds)) + "\n")
      socketio.emit('thresholds', {'thresholds': self.GetCurThresholds()})
      print('Thresholds are: ' + str(self.GetCurThresholds()))

  def ChangeProfile(self, profile_name):
    if profile_name in self.profiles:
      self.cur_profile = profile_name
      socketio.emit('thresholds', {'thresholds': self.GetCurThresholds()})
      socketio.emit('get_cur_profiles',
                    {'cur_profile': self.GetCurrentProfile()})
      print('Changed to profile "{}" with thresholds: {}'.format(
        self.GetCurrentProfile(), str(self.GetCurThresholds())))

  def GetProfileNames(self):
    return [name for name in self.profiles.keys() if name]

  def AddProfile(self, profile_name, thresholds):
    self.profiles[profile_name] = thresholds
    if self.cur_profile == "":
      self.profiles[""] = [0, 0 ,0, 0]
    self.ChangeProfile(profile_name)
    with open(self.filename, "w") as f:
      for name, thresholds in self.profiles.items():
        if name:
          f.write(name + " " + " ".join(map(str, thresholds)) + "\n")
    socketio.emit('get_profiles', {'profiles': self.GetProfileNames()})
    socketio.emit('get_cur_profiles', {'cur_profile': self.GetCurrentProfile()})
    print('Added profile "{}" with thresholds: {}'.format(
      self.GetCurrentProfile(), str(self.GetCurThresholds())))

  def RemoveProfile(self, profile_name):
    if profile_name in self.profiles:
      del self.profiles[profile_name]
      if profile_name == self.cur_profile:
        self.ChangeProfile("")
      with open(self.filename, "w") as f:
        for name, thresholds in self.profiles.items():
          if name:
            f.write(name + " " + " ".join(map(str, thresholds)) + "\n")
      socketio.emit('get_profiles', {'profiles': self.GetProfileNames()})
      socketio.emit('thresholds', {'thresholds': self.GetCurThresholds()})
      socketio.emit('get_cur_profiles',
                    {'cur_profile': self.GetCurrentProfile()})
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
  def __init__(self, profile_handler, port="", timeout=1):
    self.ser = None
    self.port = port
    self.timeout = timeout
    self.write_queue = queue.Queue(10)
    self.profile_handler = profile_handler

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
      self.ser = serial.Serial(self.port, 9600, timeout=self.timeout)
    except Exception as e:
      self.ser = None
      logger.exception("Error opening serial: %s", e)

  def Read(self):
    print("Making random numbers")
    numbers = [randint(0, 1023) for _ in range(4)]
    while not thread_stop_event.isSet():
      offsets = [int(normalvariate(0, 5)) for _ in range(4)]
      numbers = [max(0, min(numbers[i] + offsets[i], 1023)) for i in range(4)]
      socketio.emit('get_values', {'values': numbers})
      socketio.sleep(0.01)
      # if not self.ser:
      #   self.Open()
      # try:
      #   # This will block the thread until it gets a newline
      #   line = self.ser.readline()
      #   values = line.split()[1:]
      #   # We're printing Up, Right, Down, Left
      #   if len(values) == 4:
      #     for i, value in enumerate(values) :
      #       socketio.emit('newnumber' + sensor_numbers[i], {'value': value})
      # except serial.SerialException as e:
      #   logger.error("Error reading data: ", e)
      #   self.Open()

  def Write(self):
    while not thread_stop_event.isSet():
      # if not self.ser:
      #   # Just wait until the reader opens the serial port.
      #   time.sleep(1)
      #   continue

      index, value = self.write_queue.get()
      # self.ser.write(str(sensor_numbers[index]) + str(value) + "\n")

      self.profile_handler.UpdateThresholds(index, value)

profile_handler = ProfileHandler()
serial_handler = SerialHandler(profile_handler, port="")#/dev/tty/ACM0")

@app.route('/defaults')
def get_defaults():
  return {
    'profiles': profile_handler.GetProfileNames(),
    'cur_profile': profile_handler.GetCurrentProfile(),
    'thresholds': profile_handler.GetCurThresholds()
  }

@app.route('/')
def index():
  return app.send_static_file('index.html')


@socketio.on('connect')
def connect():
  global read_thread
  global write_thread
  print('Client connected')
  profile_handler.MaybeLoad()
  socketio.emit('thresholds',
    {'thresholds': profile_handler.GetCurThresholds()})

  if not read_thread.isAlive():
    print("Starting Read Thread")
    read_thread = socketio.start_background_task(serial_handler.Read)

  if not write_thread.isAlive():
    print("Starting Write Thread")
    write_thread = socketio.start_background_task(serial_handler.Write)

@socketio.on('disconnect')
def disconnect():
  print('Client disconnected')

@socketio.on('update_threshold')
def update_threshold(values, index):
  try:
    # Let the writer thread handle updating thresholds.
    serial_handler.write_queue.put((index, values[index]), block=False)
  except queue.Full as e:
    logger.error("Could not update thresholds. Queue full.")

@socketio.on('add_profile')
def add_profile(profile_name, thresholds):
  profile_handler.AddProfile(profile_name, thresholds)

@socketio.on('remove_profile')
def add_profile(profile_name):
  profile_handler.RemoveProfile(profile_name)

@socketio.on('change_profile')
def add_profile(profile_name):
  profile_handler.ChangeProfile(profile_name)

if __name__ == "__main__":
  hostname = socket.gethostname()
  ip_address = socket.gethostbyname(hostname)
  print(" * WebUI can be found at: http://" + ip_address + ":5000")
  socketio.run(app, host='0.0.0.0', port=str(port))