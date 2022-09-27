import React from "react";

import Buttons from "./buttons";
import ValueDisplay from "./valuedisplay";

const FastMonitor = (props) => {
  const { numSensors, emit, webUIDataRef, maxSize } = props;

  const evenStyles = `
  .FastMonitor-buttons .dec {
    border-left: 1px grey solid;
  }

  .FastMonitor-buttons .inc {
    border-right: 1px grey solid;
  }
  
  .FastMonitor-buttons button:first-child {
    border-radius: 40% 0 0 0;
    border-top: 1px grey solid;
    border-left: 1px grey solid;
  }
  
  .FastMonitor-buttons button:nth-child(2) {
    border-radius: 0 40% 0 0;
    border-top: 1px grey solid;
    border-right: 1px grey solid;
  }
  
  .FastMonitor-buttons button:nth-last-child(2) {
    border-radius: 0 0 0 40%;
    border-bottom: 1px grey solid;
    border-left: 1px grey solid;
  }
  
  .FastMonitor-buttons button:last-child {
    border-radius: 0 0 40% 0;
    border-bottom: 1px grey solid;
    border-right: 1px grey solid;
  }
  `;

  return (
    <header className="App-header">
      <div className="button-wrapper">
        {[...Array(numSensors).keys()].map((index) => (
          <Buttons emit={emit} index={index} webUIDataRef={webUIDataRef} />
        ))}
      </div>
      <div className="value-wrapper">
        {[...Array(numSensors).keys()].map((index) => (
          <ValueDisplay
            emit={emit}
            index={index}
            webUIDataRef={webUIDataRef}
            maxSize={maxSize}
          />
        ))}
      </div>
      <style>
        {`
          .button-wrapper {
            grid-template-columns: repeat(${numSensors}, auto)
          }
        `}
        {numSensors % 2 === 0 ? evenStyles : ""}
      </style>
    </header>
  );
};

export default FastMonitor;
