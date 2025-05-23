#include <inttypes.h>
#include <EEPROM.h>

#if !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega328P__) && \
    !defined(__AVR_ATmega1280__) && !defined(__AVR_ATmega2560__)
  #define CAN_AVERAGE
#endif

#if defined(_SFR_BYTE) && defined(_BV) && defined(ADCSRA)
  #define CLEAR_BIT(sfr, bit) (_SFR_BYTE(sfr) &= ~_BV(bit))
  #define SET_BIT(sfr, bit) (_SFR_BYTE(sfr) |= _BV(bit))
#endif

// To enable joystick support on Atmega32u4 boards such as a Leonardo or Pro Micro,
// install Arduino Joystick Library from
// https://github.com/MHeironimus/ArduinoJoystickLibrary/tree/master#installation-instructions
// then uncomment the following line.
// #define USE_ARDUINO_JOYSTICK_LIBRARY

#if defined(CORE_TEENSY)
  // Use the Joystick library for Teensy
  void ButtonStart() {
    // Use Joystick.begin() for everything that's not Teensy 2.0.
    #ifndef __AVR_ATmega32U4__
      Joystick.begin();
    #endif
    Joystick.useManualSend(true);
  }
  void ButtonPress(uint8_t button_num) {
    Joystick.button(button_num, 1);
  }
  void ButtonRelease(uint8_t button_num) {
    Joystick.button(button_num, 0);
  }
  bool ButtonSend() {
    Joystick.send_now();
    return true;
  }
#elif defined(ARDUINO_ARCH_RP2040) || defined(PICO_BOARD)
  // Use the Joystick library for Arduino-Pico
  // Teensy includes Joystick by default but Arduino-Pico requires
  // it to be included explicitly. The API is similar but it
  // is a different implementation with its own quirks.
  // Make sure to select Pico SDK for the Arduino-Pico USB stack.
  #include <Joystick.h>
  // Include tusb.h to get tud_hid_ready()
  #include "tusb.h"
  // Arduino-Pico defaults to 10ms polling interval (100Hz) but it can be
  // set to a shorter interval by declaring a usb_hid_poll_interval global.
  // Set the interval to 1 for 1000Hz polling. Requires Arduino-Pico 3.6.1
  // or newer to work. Older versions will always request a 10ms interval.
  int usb_hid_poll_interval = 1;
  void ButtonStart() {
    Joystick.begin();
    Joystick.useManualSend(true);
  }
  void ButtonPress(uint8_t button_num) {
    Joystick.button(button_num, 1);
  }
  void ButtonRelease(uint8_t button_num) {
    Joystick.button(button_num, 0);
  }
  bool ButtonSend() {
    // Wait until send_now can send with minimal delay.
    // If it isn't ready, Joystick.send_now() will block.
    // Problems are most pronounced at slower polling rates since
    // send_now() could block for a full polling interval.
    if (!tud_hid_ready()) {
      return false;
    } else {
      Joystick.send_now();
      return true;
    }
  }
#elif defined(USE_ARDUINO_JOYSTICK_LIBRARY)
  #include <Joystick.h>
  // Create the Joystick
  Joystick_ Joystick;
  void ButtonStart() {
    // Passing false disables autosend.
    Joystick.begin(false);
  }
  void ButtonPress(uint8_t button_num) {
    Joystick.pressButton(button_num);
  }
  void ButtonRelease(uint8_t button_num) {
    Joystick.releaseButton(button_num);
  }
  bool ButtonSend() {
    Joystick.sendState();
    return true;
  }
#else
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
  bool ButtonSend() {
    // Keyboard doesn't use manual send, but report success anyway.
    return true;
  }
#endif

// Default threshold value for each of the sensors.
const int16_t kDefaultThreshold = 1000;
// Max window size for both of the moving averages classes.
const size_t kWindowSize = 50;
// Baud rate used for Serial communication. Technically ignored by Teensys.
const long kBaudRate = 115200;
// Max number of sensors per panel.
// NOTE(teejusb): This is arbitrary, if you need to support more sensors
// per panel then just change the following number.
const size_t kMaxSharedSensors = 2;
// Button numbers should start with 1 (Button0 is not a valid Joystick input).
// Automatically incremented when creating a new SensorState.
uint8_t curButtonNum = 1;

/*===========================================================================*/

// EXPERIMENTAL. Used to turn on the lights feature. Note, this might conflict
// some existing sensor pins so if you see some weird behavior it might be
// because of this. Uncomment the following line to enable the feature.

// #define ENABLE_LIGHTS

// We don't want to use digital pins 0 and 1 as they're needed for Serial
// communication so we start curLightPin from 2.
// Automatically incremented when creating a new SensorState.
#if defined(ENABLE_LIGHTS)
  uint8_t curLightPin = 2;
#endif

/*===========================================================================*/

// Calculates the Weighted Moving Average for a given period size.
// Values provided to this class should fall in [−32,768, 32,767] otherwise it
// may overflow. We use a 32-bit integer for the intermediate sums which we
// then restrict back down to 16-bits.
class WeightedMovingAverage {
 public:
  WeightedMovingAverage(size_t size) :
      size_(min(size, kWindowSize)), cur_sum_(0), cur_weighted_sum_(0),
      values_{}, cur_count_(0) {}

  int16_t GetAverage(int16_t value) {
    // Add current value and remove oldest value.
    // e.g. with value = 5 and cur_count_ = 0
    // [4, 3, 2, 1] -> 10 becomes 10 + 5 - 4 = 11 -> [5, 3, 2, 1]
    int32_t next_sum = cur_sum_ + value - values_[cur_count_];
    // Update weighted sum giving most weight to the newest value.
    // [1*4, 2*3, 3*2, 4*1] -> 20 becomes 20 + 4*5 - 10 = 30
    //     -> [4*5, 1*3, 2*2, 3*1]
    // Subtracting by cur_sum_ is the same as removing 1 from each of the weight
    // coefficients.
    int32_t next_weighted_sum = cur_weighted_sum_ + size_ * value - cur_sum_;
    cur_sum_ = next_sum;
    cur_weighted_sum_ = next_weighted_sum;
    values_[cur_count_] = value;
    cur_count_ = (cur_count_ + 1) % size_;
    // Integer division is fine here since both the numerator and denominator
    // are integers and we need to return an int anyways. Off by one isn't
    // substantial here.
    // Sum of weights = sum of all integers from [1, size_]
    int16_t sum_weights = ((size_ * (size_ + 1)) / 2);
    return next_weighted_sum/sum_weights;
  }

  // Delete default constructor. Size MUST be explicitly specified.
  WeightedMovingAverage() = delete;

 private:
  size_t size_;
  int32_t cur_sum_;
  int32_t cur_weighted_sum_;
  // Keep track of all values we have in a circular array.
  int16_t values_[kWindowSize];
  size_t cur_count_;
};

// Calculates the Hull Moving Average. This is one of the better smoothing
// algorithms that will smooth the input values without wildly distorting the
// input values while still being responsive to input changes.
//
// The algorithm is essentially:
//   1. Calculate WMA of input values with a period of n/2 and double it.
//   2. Calculate WMA of input values with a period of n and subtract it from
//      step 1.
//   3. Calculate WMA of the values from step 2 with a period of sqrt(2).
//
// HMA = WMA( 2 * WMA(input, n/2) - WMA(input, n), sqrt(n) )
class HullMovingAverage {
 public:
  HullMovingAverage(size_t size) :
      wma1_(size/2), wma2_(size), hull_(sqrt(size)) {}

  int16_t GetAverage(int16_t value) {
    int16_t wma1_value = wma1_.GetAverage(value);
    int16_t wma2_value = wma2_.GetAverage(value);
    int16_t hull_value = hull_.GetAverage(2 * wma1_value - wma2_value);

    return hull_value;
  }

  // Delete default constructor. Size MUST be explicitly specified.
  HullMovingAverage() = delete;

 private:
  WeightedMovingAverage wma1_;
  WeightedMovingAverage wma2_;
  WeightedMovingAverage hull_;
};

/*===========================================================================*/

// The class that actually evaluates a sensor and actually triggers the button
// press or release event. If there are multiple sensors added to a
// SensorState, they will all be evaluated first before triggering the event.
class SensorState {
 public:
  SensorState()
      : num_sensors_(0),
        #if defined(ENABLE_LIGHTS)
        kLightsPin(curLightPin++),
        #endif
        buttonNum(curButtonNum++) {
    for (size_t i = 0; i < kMaxSharedSensors; ++i) {
      sensor_ids_[i] = 0;
      individual_states_[i] = SensorState::OFF;
    }
    #if defined(ENABLE_LIGHTS)
      pinMode(kLightsPin, OUTPUT);
    #endif
  }

  void Init() {
    if (initialized_) {
      return;
    }
    buttonNum = curButtonNum++;
    initialized_ = true;
  }

  // Adds a new sensor to share this state with. If we try adding a sensor that
  // we don't have space for, it's essentially dropped.
  void AddSensor(uint8_t sensor_id) {
    if (num_sensors_ < kMaxSharedSensors) {
      sensor_ids_[num_sensors_++] = sensor_id;
    }
  }

  // Evaluates a single sensor as part of the shared state.
  void EvaluateSensor(uint8_t sensor_id,
                      int16_t cur_value,
                      int16_t user_threshold) {
    if (!initialized_) {
      return;
    }
    size_t sensor_index = GetIndexForSensor(sensor_id);

    // The sensor we're evaluating is not part of this shared state.
    // This should not happen.
    if (sensor_index == SIZE_MAX) {
      return;
    }

    // If we're above the threshold, turn the individual sensor on.
    if (cur_value >= user_threshold + kPaddingWidth) {
      individual_states_[sensor_index] = SensorState::ON;
    }

    // If we're below the threshold, turn the individual sensor off.
    if (cur_value < user_threshold - kPaddingWidth) {
      individual_states_[sensor_index] = SensorState::OFF;
    }
    
    // If we evaluated all the sensors this state applies to, only then
    // should we determine if we want to send a press/release event.
    bool all_evaluated = (sensor_index == num_sensors_ - 1);

    if (all_evaluated) {
      switch (combined_state_) {
        case SensorState::OFF:
          {
            // If ANY of the sensors triggered, then we trigger a button press.
            bool turn_on = false;
            for (size_t i = 0; i < num_sensors_; ++i) {
              if (individual_states_[i] == SensorState::ON) {
                turn_on = true;
                break;
              }
            }
            if (turn_on) {
              ButtonPress(buttonNum);
              combined_state_ = SensorState::ON;
              #if defined(ENABLE_LIGHTS)
                digitalWrite(kLightsPin, HIGH);
              #endif
            }
          }
          break;
        case SensorState::ON:
          {
            // ALL of the sensors must be off to trigger a release.
            // i.e. If any of them are ON we do not release.
            bool turn_off = true;
            for (size_t i = 0; i < num_sensors_; ++i) {
              if (individual_states_[i] == SensorState::ON) {
                turn_off = false;
              }
            }
            if (turn_off) {
              ButtonRelease(buttonNum);
              combined_state_ = SensorState::OFF;
              #if defined(ENABLE_LIGHTS)
                digitalWrite(kLightsPin, LOW);
              #endif
            }
          }
          break;
      }
    }
  }

  // Given a sensor_id, returns the index in the sensor_ids_ array.
  // Returns SIZE_MAX if not found.
  size_t GetIndexForSensor(uint8_t sensor_id) {
    for (size_t i = 0; i < num_sensors_; ++i) {
      if (sensor_ids_[i] == sensor_id) {
        return i;
      }
    }
    return SIZE_MAX;
  }

 private:
  // Ensures that Init() has been called at exactly once on this SensorState.
  bool initialized_;

  // The collection of sensors shared with this state.
  uint8_t sensor_ids_[kMaxSharedSensors];
  // The number of sensors this state combines with.
  size_t num_sensors_;

  // Used to determine the state of each individual sensor, as well as
  // the aggregated state.
  enum State { OFF, ON };
  // The evaluated state for each individual sensor.
  State individual_states_[kMaxSharedSensors];
  // The aggregated state.
  State combined_state_ = SensorState::OFF;

  // One-tailed width size to create a window around user_threshold to
  // mitigate fluctuations by noise. 
  // TODO(teejusb): Make this a user controllable variable.
  const int16_t kPaddingWidth = 1;

  // The light pin this state corresponds to.
  #if defined(ENABLE_LIGHTS)
    const uint8_t kLightsPin;
  #endif

  // The button number this state corresponds to.
  // Set once in Init().
  uint8_t buttonNum;
};

/*===========================================================================*/

// Class containing all relevant information per sensor.
class Sensor {
 public:
  Sensor(uint8_t pin_value, SensorState* sensor_state = nullptr)
      : initialized_(false), pin_value_(pin_value),
        user_threshold_(kDefaultThreshold),
        #if defined(CAN_AVERAGE)
          moving_average_(kWindowSize),
        #endif
        offset_(0), sensor_state_(sensor_state),
        should_delete_state_(false) {}
  
  ~Sensor() {
    if (should_delete_state_) {
      delete sensor_state_;
    }
  }

  void Init(uint8_t sensor_id) {
    // Sensor should only be initialized once.
    if (initialized_) {
      return;
    }
    // Sensor IDs should be 1-indexed thus they must be non-zero.
    if (sensor_id == 0) {
      return;
    }

    // There is no state for this sensor, create one.
    if (sensor_state_ == nullptr) {
      sensor_state_ = new SensorState();
      // If this sensor created the state, then it's in charge of deleting it.
      should_delete_state_ = true;
    }

    // Initialize the sensor state.
    // This sets the button number corresponding to the sensor state.
    // Trying to re-initialize a sensor_state_ is a no-op, so no harm in 
    sensor_state_->Init();

    // If this sensor hasn't been added to the state, then try adding it.
    if (sensor_state_->GetIndexForSensor(sensor_id) == SIZE_MAX) {
      sensor_state_->AddSensor(sensor_id);
    }
    sensor_id_ = sensor_id;
    initialized_ = true;
  }

  // Fetches the sensor value and maybe triggers the button press/release.
  void EvaluateSensor(bool willSend) {
    if (!initialized_) {
      return;
    }
    // If this sensor was never added to the state, then return early.
    if (sensor_state_->GetIndexForSensor(sensor_id_) == SIZE_MAX) {
      return;
    }

    int16_t sensor_value = analogRead(pin_value_);

    #if defined(CAN_AVERAGE)
      // Fetch the updated Weighted Moving Average.
      cur_value_ = moving_average_.GetAverage(sensor_value) - offset_;
      cur_value_ = constrain(cur_value_, 0, 1023);
    #else
      // Don't use averaging for Arduino Leonardo, Uno, Mega1280, and Mega2560
      // since averaging seems to be broken with it. This should also include
      // the Teensy 2.0 as it's the same board as the Leonardo.
      // TODO(teejusb): Figure out why and fix. Maybe due to different integer
      // widths?
      cur_value_ = sensor_value - offset_;
    #endif

    if (willSend) {
      sensor_state_->EvaluateSensor(
        sensor_id_, cur_value_, user_threshold_);
    }
  }

  void UpdateThreshold(int16_t new_threshold) {
    user_threshold_ = new_threshold;
  }

  int16_t UpdateOffset() {
    // Update the offset with the last read value. UpdateOffset should be
    // called with no applied pressure on the panels so that it will be
    // calibrated correctly.
    offset_ = cur_value_;
    return offset_;
  }

  int16_t GetCurValue() {
    return cur_value_;
  }

  int16_t GetThreshold() {
    return user_threshold_;
  }

  // Delete default constructor. Pin number MUST be explicitly specified.
  Sensor() = delete;
 
 private:
  // Ensures that Init() has been called at exactly once on this Sensor.
  bool initialized_;
  // The pin on the Teensy/Arduino corresponding to this sensor.
  uint8_t pin_value_;

  // The user defined threshold value to activate/deactivate this sensor at.
  int16_t user_threshold_;
  
  #if defined(CAN_AVERAGE)
  // The smoothed moving average calculated to reduce some of the noise. 
  HullMovingAverage moving_average_;
  #endif

  // The latest value obtained for this sensor.
  int16_t cur_value_;
  // How much to shift the value read by during each read.
  int16_t offset_;

  // Since many sensors may refer to the same input this may be shared among
  // other sensors.
  SensorState* sensor_state_;
  // Used to indicate if the state is owned by this instance, or if it was
  // passed in from outside
  bool should_delete_state_;

  // A unique number corresponding to this sensor. Set during Init().
  uint8_t sensor_id_;
};

/*===========================================================================*/

// Defines the sensor collections and sets the pins for them appropriately.
//
// If you want to use multiple sensors in one panel, you will want to share
// state across them. In the following example, the first and second sensors
// share state. The maximum number of sensors that can be shared for one panel
// is controlled by the kMaxSharedSensors constant at the top of this file, but
// can be modified as needed.
//
// SensorState state1;
// Sensor kSensors[] = {
//   Sensor(A0, &state1),
//   Sensor(A1, &state1),
//   Sensor(A2),
//   Sensor(A3),
//   Sensor(A4),
// };

Sensor kSensors[] = {
  Sensor(A0),
  Sensor(A1),
  Sensor(A2),
  Sensor(A3),
};
const size_t kNumSensors = sizeof(kSensors)/sizeof(Sensor);

/*===========================================================================*/

class EepromProcessor {
  public:
    // last_used_save_slot_ is initialized to -1 before first save.
    // Will take on values from 0 to LastSaveSlot() afterwards.
    EepromProcessor() : last_used_save_slot_(-1) {}

    void SaveThresholds() {
      // Wear levelling strategy:
      // - First run: Use slot 0
      // - On rollover: Use slot 0 and clear all other slots
      // - Normal case: Use next available slot
      if (last_used_save_slot_ == -1) {
        SaveThresholdsInSlot(0);
        last_used_save_slot_ = 0;
      } else if (last_used_save_slot_ == LastSaveSlot()) {
        SaveThresholdsInSlot(0);
        // We just wrote to slot 0, so start from 1.
        for (int save_slot = 1; save_slot <= LastSaveSlot(); ++save_slot) {
          MarkSlotTaken(save_slot, false);
        }
        last_used_save_slot_ = 0;
      } else {
        SaveThresholdsInSlot(last_used_save_slot_);
        // Increment only once the write is complete.
        last_used_save_slot_++;
      }
      Serial.print("s");
      for (size_t i = 0; i < kNumSensors; ++i) {
        Serial.print(" ");
        Serial.print(kSensors[i].GetThreshold());
      }
      Serial.print("\n");
    }

    void LoadThresholds() {
      FindLastUsedSaveSlot();
      if (last_used_save_slot_ == -1) {
        return;
      }
      for (size_t sensor_idx = 0; sensor_idx < kNumSensors; ++sensor_idx) {
        RestoreThreshold(sensor_idx);
      }
    }

  private:
    size_t SaveSlotSizeBytes() {
      // +1 for the fake marker sensor, *2 because int16_t
      return (kNumSensors + 1) * 2;
    }

    int LastSaveSlot() {
      // -1 because it's the last VALID index.
      return (EEPROM.length() / SaveSlotSizeBytes()) - 1;
    }

    void SaveThreshold(
        int save_slot, size_t sensor_idx, int16_t threshold) {
      size_t offset = save_slot * SaveSlotSizeBytes();
      uint8_t b1 = (threshold & 0xFF);
      uint8_t b2 = (threshold >> 8);
      EEPROM.write(offset + sensor_idx * 2,     b1);
      EEPROM.write(offset + sensor_idx * 2 + 1, b2);
    }

    int16_t ReadThreshold(int save_slot, size_t sensor_idx) {
      size_t offset = save_slot * SaveSlotSizeBytes();
      uint8_t b1 = EEPROM.read(offset + sensor_idx * 2);
      uint8_t b2 = EEPROM.read(offset + sensor_idx * 2 + 1);
      return (b2 << 8) | b1;
    }

    void MarkSlotTaken(int save_slot, bool is_taken) {
      SaveThreshold(
          save_slot, kNumSensors, is_taken ? SAVE_SLOT_TAKEN_MARKER : 0);
    }

    bool IsSlotTaken(int save_slot) {
      return ReadThreshold(save_slot, kNumSensors) == SAVE_SLOT_TAKEN_MARKER;
    }

    void FindLastUsedSaveSlot() {
      for (int save_slot = LastSaveSlot(); save_slot >= 0 ; --save_slot) {
        if (IsSlotTaken(save_slot)){
          last_used_save_slot_ = save_slot;
          return;
        }
      }
      last_used_save_slot_ = -1;
    }

    void RestoreThreshold(size_t sensor_idx) {
      kSensors[sensor_idx].UpdateThreshold(
          ReadThreshold(last_used_save_slot_, sensor_idx));
    }

    void SaveThresholdsInSlot(int save_slot) {
      for (size_t sensor_idx = 0; sensor_idx < kNumSensors; ++sensor_idx) {
        SaveThreshold(
            save_slot, sensor_idx, kSensors[sensor_idx].GetThreshold());
      }
      MarkSlotTaken(save_slot, true);
    }

    // Any negative number would do, as actual thresholds are >=0.
    const int16_t SAVE_SLOT_TAKEN_MARKER = -42;
    int last_used_save_slot_;
};

class SerialProcessor {
 public:
   void Init(long baud_rate) {
    Serial.begin(baud_rate);
  }

  void CheckAndMaybeProcessData() {
    while (Serial.available() > 0) {
      size_t bytes_read = Serial.readBytesUntil(
          '\n', buffer_, kBufferSize - 1);
      buffer_[bytes_read] = '\0';

      if (bytes_read == 0) { return; }
 
      switch(buffer_[0]) {
        case 'o':
        case 'O':
          UpdateOffsets();
          break;
        case 'v':
        case 'V':
          PrintValues();
          break;
        case 't':
        case 'T':
          PrintThresholds();
          break;
        case 's':
        case 'S':
          eeprom_processor_.SaveThresholds();
          break;
        case '0' ... '9': // Case ranges are non-standard but work in gcc.
          UpdateAndPrintThreshold(bytes_read);
        default:
          break;
      }
    }  
  }

  void UpdateAndPrintThreshold(size_t bytes_read) {
    // Need to specify:
    // Sensor number + Threshold value, separated by a space.
    // {0, 1, 2, 3,...} + "0"-"1023"
    // e.g. 3 180 (fourth FSR, change threshold to 180)
    
    if (bytes_read < 3 || bytes_read > 7) { return; }

    char* next = nullptr;
    size_t sensor_index = strtoul(buffer_, &next, 10);
    if (sensor_index >= kNumSensors) { return; }

    int16_t sensor_threshold = strtol(next, nullptr, 10);
    if (sensor_threshold < 0 || sensor_threshold > 1023) { return; }

    kSensors[sensor_index].UpdateThreshold(sensor_threshold);
    PrintThresholds();
  }

  void UpdateOffsets() {
    for (size_t i = 0; i < kNumSensors; ++i) {
      kSensors[i].UpdateOffset();
    }
  }

  void PrintValues() {
    Serial.print("v");
    for (size_t i = 0; i < kNumSensors; ++i) {
      Serial.print(" ");
      Serial.print(kSensors[i].GetCurValue());
    }
    Serial.print("\n");
  }

  void PrintThresholds() {
    Serial.print("t");
    for (size_t i = 0; i < kNumSensors; ++i) {
      Serial.print(" ");
      Serial.print(kSensors[i].GetThreshold());
    }
    Serial.print("\n");
  }

  void LoadThresholdsFromEeprom() {
    eeprom_processor_.LoadThresholds();
  }

 private:
   static const size_t kBufferSize = 64;
   char buffer_[kBufferSize];

   EepromProcessor eeprom_processor_;
};

/*===========================================================================*/

SerialProcessor serialProcessor;
// Timestamps are always "unsigned long" regardless of board type So don't need
// to explicitly worry about the widths.
unsigned long lastSend = 0;
// loopTime is used to estimate how long it takes to run one iteration of
// loop().
long loopTime = -1;

void setup() {
  serialProcessor.Init(kBaudRate);
  ButtonStart();
  for (size_t i = 0; i < kNumSensors; ++i) {
    // Button numbers should start with 1.
    kSensors[i].Init(i + 1);
  }
  
  serialProcessor.LoadThresholdsFromEeprom();

  #if defined(CLEAR_BIT) && defined(SET_BIT)
	  // Set the ADC prescaler to 16 for boards that support it,
	  // which is a good balance between speed and accuracy.
	  // More information can be found here: http://www.gammon.com.au/adc
	  SET_BIT(ADCSRA, ADPS2);
	  CLEAR_BIT(ADCSRA, ADPS1);
	  CLEAR_BIT(ADCSRA, ADPS0);
  #endif
}

void loop() {
  unsigned long startMicros = micros();
  // We only want to send over USB every millisecond, but we still want to
  // read the analog values as fast as we can to have the most up to date
  // values for the average.
  static bool willSend;
  // Separate out the initialization and the update steps for willSend.
  // Since willSend is static, we want to make sure we update the variable
  // every time we loop.
  willSend = (loopTime == -1 || startMicros - lastSend + loopTime >= 1000);

  serialProcessor.CheckAndMaybeProcessData();

  for (size_t i = 0; i < kNumSensors; ++i) {
    kSensors[i].EvaluateSensor(willSend);
  }

  if (willSend) {
    bool sent = ButtonSend();
    if (sent) {
      lastSend = startMicros;
    }
  }

  if (loopTime == -1) {
    loopTime = micros() - startMicros;
  }
}
