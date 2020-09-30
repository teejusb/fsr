// Default threshold value for each of the sensors.
const unsigned int kDefaultThreshold = 200;
// Max window size for both of the moving averages classes.
const size_t kWindowSize = 100;

/*===========================================================================*/

// Calculates the Weighted Moving Average for a given period size.
class WeightedMovingAverage {
 public:
  WeightedMovingAverage(size_t size) : size_(min(size, kWindowSize)) {}

  int GetAverage(int value) {
    int next_sum = cur_sum_ + value - values_[cur_count_];
    int next_weighted_sum = cur_weighted_sum_ + size_ * value - cur_sum_;
    cur_sum_ = next_sum;
    cur_weighted_sum_ = next_weighted_sum;
    values_[cur_count_] = value;
    cur_count_ = (cur_count_ + 1) % size_;
    // Integer division is fine here since both the numerator and denominator
    // are integers and we need to return an int anyways. Off by one isn't
    // substantial here.
    return next_weighted_sum/((size_ * (size_ + 1)) / 2);
  }

  // Delete default constructor. Size MUST be explicitly specified.
  WeightedMovingAverage() = delete;

 private:
  size_t size_;
  int cur_sum_;
  int cur_weighted_sum_;
  // Keep track of all values we have in a circular array.
  int values_[kWindowSize];
  size_t cur_count_;
};

// Calculates the Hull Moving Average. This is one of the better smoothing
// algorithms that will smooth the input values without wildly distorting the
// input values while still being responsive to input changes.
//
// The algorithm is essentially:
//   1. Calculate WMA of input values with a period of n/2 and multiply it by 2.
//   2. Calculate WMA of input values with a period of n and subtract it from step 1.
//   3. Calculate WMA of the values from step 2 with a period of sqrt(2).
//
// HMA = WMA( 2 * WMA(input, n/2) - WMA(input, n), sqrt(n) )
class HullMovingAverage {
 public:
  HullMovingAverage(size_t size) :
      wma1_(size/2), wma2_(size), hull_(sqrt(size)) {}

  int GetAverage(int value) {
    int wma1_value = wma1_.GetAverage(value);
    int wma2_value = wma2_.GetAverage(value);
    int hull_value = hull_.GetAverage(2 * wma1_value - wma2_value);

    return hull_value;
  }

 private:
  WeightedMovingAverage wma1_;
  WeightedMovingAverage wma2_;
  WeightedMovingAverage hull_;
};

/*===========================================================================*/

// Class containing all relevant information per sensor.
class SensorState {
 public:
  SensorState(unsigned int pin_value) :
      pin_value_(pin_value), state_(SensorState::OFF),
      user_threshold_(kDefaultThreshold), moving_average_(kWindowSize),
      offset_(0) {}

  // Fetches the sensor value and maybe triggers the button press/release.
  void EvaluateSensor(int joystick_num) {
    int sensor_value = analogRead(pin_value_);

    // Fetch the updated Weighted Moving Average.
    cur_value_ = moving_average_.GetAverage(sensor_value) - offset_;

    if (cur_value_ >= user_threshold_ + kPaddingWidth &&
        state_ == SensorState::OFF) {
      Joystick.button(joystick_num, 1);
      state_ = SensorState::ON;
    }
    
    if (cur_value_ < user_threshold_ - kPaddingWidth &&
        state_ == SensorState::ON) {
      Joystick.button(joystick_num, 0);
      state_ = SensorState::OFF;
    }
  }

  void UpdateThreshold(unsigned int new_threshold) {
    user_threshold_ = new_threshold;
  }

  unsigned int UpdateOffset() {
    // Update the offset with the last read value. UpdateOffset should be
    // called with no applied pressure on the panels so that it will be
    // calibrated correctly.
    offset_ = cur_value_;
    return offset_;
  }

  int GetCurValue() {
    return cur_value_;
  }

  int GetThreshold() {
    return user_threshold_;
  }

  // Delete default constructor. Pin number MUST be explicitly specified.
  SensorState() = delete;
 
 private:
  // The pin on the Teensy/Arduino corresponding to this sensor.
  unsigned int pin_value_;
  // The current joystick state of the sensor.
  enum State { OFF, ON };
  State state_;
  // The user defined threshold value to activate/deactivate this sensor at.
  int user_threshold_;
  // One-tailed width size to create a window around user_threshold_ to
  // mitigate fluctuations by noise. 
  // TODO(teejusb): Make this a user controllable variable.
  const int kPaddingWidth = 1;
  
  // The smoothed moving average calculated to reduce some of the noise. 
  // NOTE(teejusb): Can use the HullMovingAverage as well, but
  // WeightedMovingAverage seemed sufficient.
  WeightedMovingAverage moving_average_;

  int cur_value_;

  int offset_;
};

/*===========================================================================*/

// Defines the sensor collections and sets the pins for them appropriately.
// NOTE(teejusb): These may need to be changed depending on the pins users
// connect their FSRs to.
SensorState kSensorStates[] = {
  SensorState(A0),
  SensorState(A1),
  SensorState(A2),
  SensorState(A3),
};
const size_t kNumSensors = sizeof(kSensorStates)/sizeof(SensorState);

/*===========================================================================*/

class SerialProcessor {
 public:
   void Init(unsigned int baud_rate) {
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
        default:
          UpdateThreshold(bytes_read);
          break;
      }
    }  
  }

  void UpdateThreshold(size_t bytes_read) {
    // Need to specify:
    // Sensor number + Threshold value.
    // {0, 1, 2, 3} + "0"-"1023"
    // e.g. 3180 (fourth FSR, change threshold to 180)
    
    if (bytes_read < 2 || bytes_read > 5) { return; }

    size_t sensor_index = buffer_[0] - '0';
    if (sensor_index < 0 || sensor_index >= kNumSensors) { return; }

    kSensorStates[sensor_index].UpdateThreshold(
        strtoul(buffer_ + 1, nullptr, 10));
  }

  void UpdateOffsets() {
    for (size_t i = 0; i < kNumSensors; ++i) {
      kSensorStates[i].UpdateOffset();
    }
  }

  void PrintValues() {
    Serial.print("v");
    for (size_t i = 0; i < kNumSensors; ++i) {
      Serial.print(" ");
      Serial.print(kSensorStates[i].GetCurValue());
    }
    Serial.print("\n");
  }

  void PrintThresholds() {
    Serial.print("t");
    for (size_t i = 0; i < kNumSensors; ++i) {
      Serial.print(" ");
      Serial.print(kSensorStates[i].GetThreshold());
    }
    Serial.print("\n");
  }

 private:
   static const size_t kBufferSize = 64;
   char buffer_[kBufferSize];
};

/*===========================================================================*/

SerialProcessor kSerialProcessor;

void setup() {
  kSerialProcessor.Init(115200);
  Joystick.begin();
}

void loop() {
  static unsigned int counter = 0;
  if (counter++ % 10 == 0) {
    kSerialProcessor.CheckAndMaybeProcessData();
  }

  for (size_t i = 0; i < kNumSensors; ++i) {
    kSensorStates[i].EvaluateSensor(i + 1);
  }
}
