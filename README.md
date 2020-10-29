# fsr
FSR code used for dance pads


## Requirements
- A [Teensy](https://www.pjrc.com/store/index.html)
- Python 3.6+
    - virtualenv
- Node 12+
  - yarn or npm

## Hardware setup
Follow a guide like [fsr-pad-guide](https://github.com/Sereni/fsr-pad-guide) or [fsr](https://github.com/vlnguyen/itg-fsr/tree/master/fsr) to setup your Arduino/Teensy with FSRs.

## Firmware setup
1. Install [Arduino IDE](https://www.arduino.cc/en/software) (skip this if you're using OSX as it's included in Teensyduino)
1. Install [Teensyduino](https://www.pjrc.com/teensy/td_download.html) and get it connected to your Teensy and able to push firmware via Arduino IDE
1. In Arduinio IDE, set the `Tools` > `USB Type` to `Serial + Keyboard + Mouse + Joystick`
1. In Arduinio IDE, set the `Tools` > `Board` to `Teensy 4.0`

1. In Arduinio IDE, set the `Tools` > `Port` select the COM port of the plugged in Teensy
1. Copy in the code from [fsr.ino](./fsr.ino)
1. By default, [A0-A3 are the pins](https://forum.pjrc.com/teensy40_pinout1.png) used for the FSR sensors in this software. If you aren't using these pins [alter the SensorState array](fsr.ino#L204-L209)
1. Push the code to the board

### Testing and using the serial monitor
1. Open `Tools` > `Serial Monitor` to open the Serial Monitor
1. Within the serial monitor, enter `t` to show current thresholds.
1. You can change a sensor threshold by entering numbers, where the first number is the sensor (0-indexed) followed by the threshold value. For example, `3180` would set the 4th sensor to 180 thresholds.  You can change these more easily in the UI later.
1. Enter `v` to get the current sensor values.
1. Putting pressure on an FSR, you should notice the values change if you enter `v` again while maintaining pressure.


## UI setup
1. Install [Python](https://www.python.org/downloads/)
1. Install [Node](https://nodejs.org/en/download/)
    - You may optionally install [yarn](https://classic.yarnpkg.com/en/docs/install#windows-stable). Alternatively, you can substitute `yarn` commands for `npm` which should have came with Node.
1. Within [server.py](./webui/server/server.py), edit the `SERIAL_PORT` constant to match the serial port shown in the Arduino IDE (e.g. it might look like `"/dev/ttyACM0"` or `"COM1"`)
    - You also may need to modify the `sensor_numbers` variable. These sensor numbers come from fsr.ino.
    - For Example, youre using Analog 6, 5, 4, 3. analog 6 is left, 5 is Down, 4 is up, 3 is right. in FSR.ino the order you listed them is the order they will be addressed in server.py
1. Open a command prompt (or terminal) and navigate to `./webui/server` with `cd webui/server`
1. Run `python -m venv venv`
1. Run `venv\Scripts\activate`
1. Run `pip install -r requirements.txt` to install dependencies
1. Then move to the `./webui` directory by doing `cd ..`
1. Run `yarn install && yarn build && yarn start-api`

The UI should be up and running on http://localhost:3000 and you can use your device IP and the port to reach it from your phone (e.g. 192.168.0.xxx:5000 )




## Tips 
- so if you do use localhost in your browser, and if the ui looks choppy, try using your local IP instead
