from random import randint
from threading import Thread, Event
import time
import logging
from flask import Flask
from flask_socketio import SocketIO, emit

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

logging.getLogger('werkzeug').setLevel(logging.ERROR)

#random number Generator Thread
thread = Thread()
thread_stop_event = Event()

cur_thresholds = [0, 0, 0, 0]

def randomNumberGenerator():
  """
  Generate a random number every 1 second and emit to a socketio instance (broadcast)
  Ideally to be run in a separate thread?
  """
  #infinite loop of magical random numbers
  print("Making random numbers")
  while not thread_stop_event.isSet():
    numbers = [randint(0, 1023) for _ in range(4)]
    print(str(numbers))
    socketio.emit('newnumber', {'numbers': numbers})
    socketio.sleep(5)

@app.route('/defaults')
def get_defaults():
  return { 'thresholds': cur_thresholds }

@app.route('/time')
def get_current_time():
  return {'time': time.time()}


@socketio.on('connect')
def connect():
  global thread
  print('Client connected')
  if not thread.isAlive():
    print("Starting Thread")
    thread = socketio.start_background_task(randomNumberGenerator)


@socketio.on('disconnect')
def disconnect():
  print('Client disconnected')


@socketio.on('update_threshold')
def update_threshold(index, value):
  global cur_thresholds
  cur_thresholds[index] = value
  print('Values are: ' + str(cur_thresholds))


if __name__ == "__main__":
  # t = threading.Thread(target=generater.generate)
  # t.start()
  socketio.run(app)