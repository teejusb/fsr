import React, { useCallback } from "react";

const Buttons = (props) => {
  const { emit, index, webUIDataRef } = props;
  const curThresholds = webUIDataRef.current.curThresholds;

  const EmitValue = useCallback(
    (val) => {
      // Send back all the thresholds instead of a single value per sensor. This is in case
      // the server restarts where it would be nicer to have all the values in sync.
      // Still send back the index since we want to update only one value at a time
      // to the microcontroller.
      emit(["update_threshold", curThresholds, index]);
    },
    [curThresholds, emit, index]
  );

  const Decrement = (num) => {
    const val = curThresholds[index] - num;
    if (val >= 0) {
      curThresholds[index] = val;
      EmitValue(val);
    }
  };

  const Increment = (num) => {
    const val = curThresholds[index] + num;
    if (val <= 1023) {
      curThresholds[index] = val;
      EmitValue(val);
    }
  };

  return (
    <>
      <div className="FastMonitor-buttons" data={index}>
        <button className="dec" onClick={() => Decrement(10)}>
          -10
        </button>
        <button className="inc" onClick={() => Increment(10)}>
          +10
        </button>
        <button className="dec" onClick={() => Decrement(5)}>
          -5
        </button>
        <button className="inc" onClick={() => Increment(5)}>
          +5
        </button>
        <button className="dec" onClick={() => Decrement(1)}>
          -1
        </button>
        <button className="inc" onClick={() => Increment(1)}>
          +1
        </button>
      </div>
    </>
  );
};

export default Buttons;
