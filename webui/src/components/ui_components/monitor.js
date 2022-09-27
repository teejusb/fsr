import React from "react";

import Row from "react-bootstrap/Row";

import NewMonitor from "./newmonitor";

const Monitor = (props) => {
  const { numSensors, emit, webUIDataRef, maxSize } = props;

  const evenStyles = `
  .monitor-buttons .dec {
    border-left: 1px grey solid;
  }

  .monitor-buttons .inc {
    border-right: 1px grey solid;
  }
  
  .monitor-buttons button:first-child {
    border-radius: 40% 0 0 0;
    border-top: 1px grey solid;
    border-left: 1px grey solid;
    background-color: white;
  }
  
  .monitor-buttons button:nth-child(2) {
    border-radius: 0 40% 0 0;
    border-top: 1px grey solid;
    border-right: 1px grey solid;
    background-color: white;
  }

  .monitor-buttons button:nth-child(3) {
    background-color: lightgrey;
  }

  .monitor-buttons button:nth-child(4) {
    background-color: lightgrey;
  }
  
  .monitor-buttons button:nth-last-child(2) {
    border-radius: 0 0 0 40%;
    border-bottom: 1px grey solid;
    border-left: 1px grey solid;
    background-color: darkgrey;
  }
  
  .monitor-buttons button:last-child {
    border-radius: 0 0 40% 0;
    border-bottom: 1px grey solid;
    border-right: 1px grey solid;
    background-color: darkgrey;
  }
  `;

  return (
    <header className="App-header">
      <Row className="monitor-row">
        {[...Array(numSensors).keys()].map((index) => (
          <NewMonitor
            emit={emit}
            index={index}
            webUIDataRef={webUIDataRef}
            maxSize={maxSize}
          />
        ))}
      </Row>
      <style>{numSensors % 2 === 0 ? evenStyles : ""}</style>
    </header>
  );
};

export default Monitor;
