import React from "react";

import Row from "react-bootstrap/Row";

import NewMonitor from "./newmonitor";

const MonitorPage = (props) => {
  const { numSensors, emit, webUIDataRef, maxSize, deviceType } = props;
  const INDEX_TO_DIR = {}

  if (numSensors === 4) {
    INDEX_TO_DIR['0'] = "LEFT";
    INDEX_TO_DIR['1'] = "DOWN";
    INDEX_TO_DIR['2'] = "UP";
    INDEX_TO_DIR['3'] = "RIGHT";
  } else if (numSensors === 6) {
    INDEX_TO_DIR['0'] = "LEFT";
    INDEX_TO_DIR['1'] = "DOWN (L)";
    INDEX_TO_DIR['2'] = "DOWN (R)";
    INDEX_TO_DIR['3'] = "UP (L)";
    INDEX_TO_DIR['4'] = "UP (R)";
    INDEX_TO_DIR['5'] = "RIGHT";
  }

  return (
    <header className="App-header">
      <Row className="monitor-row">
        {[...Array(numSensors).keys()].map((index) => (
          <NewMonitor
            deviceType={deviceType}
            dir={INDEX_TO_DIR[index] ? INDEX_TO_DIR[index] : index}
            emit={emit}
            index={index}
            webUIDataRef={webUIDataRef}
            maxSize={maxSize}
            even={numSensors % 2 === 0}
          />
        ))}
      </Row>
    </header>
  );
};

export default MonitorPage;
