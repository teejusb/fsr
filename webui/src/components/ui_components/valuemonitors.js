import React from "react";
import Container from "react-bootstrap/Container";
import Row from "react-bootstrap/Row";

const ValueMonitors = (props) => {
  const { numSensors, className } = props;
  return (
    <header className="App-header">
      <Container fluid style={{ border: "1px solid white", height: "100vh" }}>
        <Row className={className ? className : "ValueMonitor-row"}>
          {props.children}
        </Row>
      </Container>
      <style>
        {`
          .ValueMonitor-col {
            width: ${100 / numSensors}%;
          }
          `}
      </style>
    </header>
  );
};

export default ValueMonitors;
