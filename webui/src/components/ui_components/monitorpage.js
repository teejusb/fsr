import React from "react";

import NewMonitor from "./newmonitor";

const MonitorPage = (props) => {
  const { numSensors, emit, webUIDataRef, maxSize, deviceType } = props;
  const INDEX_TO_DIR = {}

  if (numSensors === 4) {
    INDEX_TO_DIR['0'] = "L";
    INDEX_TO_DIR['1'] = "D";
    INDEX_TO_DIR['2'] = "U";
    INDEX_TO_DIR['3'] = "R";
  } else if (numSensors === 6) {
    INDEX_TO_DIR['0'] = "L";
    INDEX_TO_DIR['1'] = "D (L)";
    INDEX_TO_DIR['2'] = "D (R)";
    INDEX_TO_DIR['3'] = "U (L)";
    INDEX_TO_DIR['4'] = "U (R)";
    INDEX_TO_DIR['5'] = "R";
  }

  return (
    <header className="App-header">
      <section className="monitor-row">
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
      </section>
    </header>
  );
};

export default MonitorPage;
