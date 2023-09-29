# Teejusb's FSR Guide
A complete software package for FSR dance pads.  
Join the [![Discord](https://img.shields.io/discord/778312862425939998?color=5865F2&label=Discord&logo=discord&logoColor=white)](https://discord.com/invite/RamvtwuEF2) for any questions/suggestions

## Features
- React web UI to customize sensitivity 
- Profiles & persistence
- Light support

## Screenshots
<img src="./img/fsr2.gif" width="550">

<img src="./img/fsr1.gif" width="550">


## Requirements
- A [Teensy](https://www.pjrc.com/store/index.html) or Arduino
  - uses native keyboard library for Arduino and Joystick library for Teensy
- Python 3.7-3.10 (needs updating for 3.11+)
    - virtualenv
- Node 12-16 (needs updating for 17+)
  - yarn

## Hardware setup
Follow a guide like [fsr-pad-guide](https://github.com/Sereni/fsr-pad-guide) or [fsr](https://github.com/vlnguyen/itg-fsr/tree/master/fsr) to setup your Arduino/Teensy with FSRs.

## Firmware setup
1. Install [Arduino IDE](https://www.arduino.cc/en/software) (skip this if you're using OSX as it's included in Teensyduino)
1. Install [Teensyduino](https://www.pjrc.com/teensy/td_download.html) and get it connected to your Teensy and able to push firmware via Arduino IDE
1. In Arduino IDE, set the `Tools` > `USB Type` to `Serial + Keyboard + Mouse + Joystick` (or `Serial + Keyboard + Mouse`)
1. In Arduino IDE, set the `Tools` > `Board` to your microcontroller (e.g. `Teensy 4.0`)
1. In Arduino IDE, set the `Tools` > `Port` to select the serial port for the plugged in microcontroller (e.g. `COM5` or `/dev/something`)
1. Load [fsr.ino](./fsr.ino) in Arduino IDE.
1. By default, [A0-A3 are the pins](https://forum.pjrc.com/teensy40_pinout1.png) used for the FSR sensors in this software. If you aren't using these pins [alter the SensorState array](./fsr.ino#L437-L442)
1. Push the code to the board

### Testing and using the serial monitor
1. Open `Tools` > `Serial Monitor` to open the Serial Monitor
1. Within the serial monitor, enter `t` to show current thresholds.
1. You can change a sensor threshold by entering numbers, where the first number is the sensor (0-indexed) followed by the threshold value. For example, `3 180` would set the 4th sensor to a threshold of 180.  You can change these more easily in the UI later.
1. Enter `v` to get the current sensor values.
1. Putting pressure on an FSR, you should notice the values change if you enter `v` again while maintaining pressure.


## UI setup
1. Install [Python](https://www.python.org/downloads/). On Linux you can install Python with your distribution's package manager. On some systems you might have to additionally install the python3 header files (usually called `python3-dev` or similar).
1. Install [Node](https://nodejs.org/en/download/)
    - Install [yarn](https://classic.yarnpkg.com/en/docs/install#windows-stable). A quick way to do this is with NPM: `npm install -g yarn`
1. Within [server.py](./webui/server/server.py), edit the `SERIAL_PORT` constant to match the serial port shown in the Arduino IDE (e.g. it might look like `"/dev/ttyACM0"` or `"COM1"`)
    - You also may need to [modify](https://github.com/teejusb/fsr/pull/1#discussion_r514585060) the `sensor_numbers` variable.
1. Open a command prompt (or terminal) and navigate to `./webui/server` with `cd webui/server`
1. Run `python -m venv venv` (you may need to replace `python` with `py` on Windows or potentially `python3` on Linux)
1. Run `venv\Scripts\activate` (on Linux you run `source venv/bin/activate`)
1. Run `pip install -r requirements.txt` to install dependencies (might need to use `pip3` instead of `pip` on Linux)
1. Then move to the `./webui` directory by doing `cd ..`
1. Run `yarn install && yarn build && yarn start-api`
    - On Linux, you'll also need to edit the `start-api` script in `./webui/package.json` to reference `venv/bin/python` instead of `venv/Scripts/python`

The UI should be up and running on http://localhost:5000 and you can use your device IP and the port to reach it from your phone (e.g. http://192.168.0.xxx:5000 )


## Troubleshooting 
- If you use localhost in your browser and if the UI looks choppy, try using your local IP instead
- If you see the following error, ensure the "Serial Monitor" isn't already open in Arduino IDE `serial.serialutil.SerialException: [Errno 16] could not open port /dev/cu.usbmodem83828101: [Errno 16] Resource busy: '/dev/cu.usbmodem83828101`
- If you notice that your input is delayed and perhaps that delay increases over time, you can sometimes rectify that by restarting the server. Close your `start-api` window and run it again.

## Tips
### Make a desktop shortcut (Windows)
Create a new text file called `start_fsrs.bat` and place it on your desktop.
```bat
start "" http://YOUR_PC_NAME_OR_IP:5000/
cd C:\Users\YourUser\path\to\fsr\webui
yarn start-api
```
Now you can just click on that file to open the UI and start the server.


## Joystick Support on Arduino Leonardo and Pro Micro

The FSR firmware will configure Teensy devices as USB joysticks, and other Arduino devices as USB keyboards. Some Arduino boards such as the Arduino Leonardo and Sparkfun's Pro Micro can be configured as Joysticks using an additional third-party library. Here is an example of how to add joystick support.

Install ArduinoJoystickLibrary, by following the installation instructions in that project's readme. https://github.com/MHeironimus/ArduinoJoystickLibrary#installation-instructions

> 1. Download https://github.com/MHeironimus/ArduinoJoystickLibrary/archive/master.zip
> 2. In the Arduino IDE, select Sketch > Include Library > Add .ZIP Library.... Browse to where the downloaded ZIP file is located and click Open.

Find these lines that set up keyboard support in fsr.ino and delete them.
```c++
  #include <Keyboard.h>
  // And the Keyboard library for Arduino
  void ButtonStart() {
    Keyboard.begin();
  }
  void ButtonPress(uint8_t button_num) {
    Keyboard.press('a' + button_num - 1);
  }
  void ButtonRelease(uint8_t button_num) {
    Keyboard.release('a' + button_num - 1);
  }
```

Replace the deleted lines with this Joystick code in the same spot.
```c++
  #include <Joystick.h>
  // Create the Joystick
  Joystick_ Joystick;
  void ButtonStart() {
    // Passing false disables autosend.
    Joystick.begin(false);
  }
  void ButtonPress(uint8_t button_num) {
    Joystick.pressButton(button_num - 1);
  }
  void ButtonRelease(uint8_t button_num) {
    Joystick.releaseButton(button_num - 1);
  }
```

Find the following code that sends the joystick updates.
```c++
  if (willSend) {
    lastSend = startMicros;
    #ifdef CORE_TEENSY
        Joystick.send_now();
    #endif
  }
```

Change it to the following.
```c++
  if (willSend) {
    lastSend = startMicros;
    #ifdef CORE_TEENSY
        Joystick.send_now();
    #else
        Joystick.sendState();
    #endif
  }
```

That's all of the changes needed. To summarize another way, here is the full diff for the changes to fsr.ino. Lines starting with a `-` are deleted and lines starting with a `+` are added. 

```diff
diff --git a/fsr.ino b/fsr.ino
index 5321534..560489e 100644
--- a/fsr.ino
+++ b/fsr.ino
@@ -27,16 +27,18 @@
     Joystick.button(button_num, 0);
   }
 #else
-  #include <Keyboard.h>
-  // And the Keyboard library for Arduino
+  #include <Joystick.h>
+  // Create the Joystick
+  Joystick_ Joystick;
   void ButtonStart() {
-    Keyboard.begin();
+    // Passing false disables autosend.
+    Joystick.begin(false);
   }
   void ButtonPress(uint8_t button_num) {
-    Keyboard.press('a' + button_num - 1);
+    Joystick.pressButton(button_num - 1);
   }
   void ButtonRelease(uint8_t button_num) {
-    Keyboard.release('a' + button_num - 1);
+    Joystick.releaseButton(button_num - 1);
   }
 #endif
 
@@ -598,6 +600,8 @@ void loop() {
     lastSend = startMicros;
     #ifdef CORE_TEENSY
         Joystick.send_now();
+    #else
+        Joystick.sendState();
     #endif
   }
```

### Advanced Joystick Configuration

By default, ArduinoJoystickLibrary creates a joystick with 32 buttons and several other inputs. If you check the dance pad in a USB game controller test program, it will show buttons and analog axes that are never actually used. Optionally, you can configure the joystick to have only the necessary number of buttons, and no analog sticks or extra controls.

Instead of calling the constructor with default arguments,

```c++
  // Create the Joystick
  Joystick_ Joystick;
```

pass the various configuration arguments as shown below. If your dance pad has more than 4 buttons, make sure the button count is big enough.

```c++
  // Create the Joystick
  Joystick_ Joystick(
    JOYSTICK_DEFAULT_REPORT_ID,
    JOYSTICK_TYPE_GAMEPAD,
    4,     // Button Count
    0,     // Hat Switch Count
    false, // X axis
    false, // Y axis
    false, // Z Axis
    false, // Rx
    false, // Ry
    false, // Rz
    false, // Rudder
    false, // Throttle
    false, // Accelerator,
    false, // Brake
    false  // Steering
  );
```