import logging
import queue
import serial
import time

from flask import Flask
from flask_socketio import SocketIO, emit
from random import normalvariate, randint
from threading import Thread, Event

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

logging.getLogger('werkzeug').setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

# Threads for the serial reader and writer.
read_thread = Thread()
write_thread = Thread()
thread_stop_event = Event()

cur_thresholds = [0, 0, 0, 0]
# L, D, U, R
sensor_numbers = [3, 2, 0, 1]

class SerialHandler(object):
  def __init__(self, port="", timeout=1):
    self.ser = None
    self.port = port
    self.timeout = timeout
    self.write_queue = queue.Queue(10)

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
      # print(str(numbers))
      for i in range(4):
        socketio.emit('newnumber' + str(i), {'value': numbers[i]})
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

      global cur_thresholds
      cur_thresholds[index] = value
      print('Thresholds are: ' + str(cur_thresholds))


serial_handler = SerialHandler(port="")#/dev/tty/ACM0")

@app.route('/defaults')
def get_defaults():
  return {}

@app.route('/time')
def get_current_time():
  return {'time': time.time()}


@socketio.on('connect')
def connect():
  global read_thread
  global write_thread
  print('Client connected')
  # TODO(teejusb): Fetch cur_thresholds from somewhere.
  socketio.emit('thresholds', {'thresholds': cur_thresholds})

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
    serial_handler.write_queue.put((index, values[index]), block=False)
  except queue.Full as e:
    logger.error("Could not update thresholds. Queue full.")


if __name__ == "__main__":
  # t = threading.Thread(target=generater.generate)
  # t.start()
  socketio.run(app)