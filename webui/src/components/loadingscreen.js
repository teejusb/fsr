import React from "react";

import Navbar from "react-bootstrap/Navbar";

const LoadingScreen = () => {
  return (
    <div className="loading-main">
      <Navbar bg="light">
        <Navbar.Brand as={"span"} to="/">
          FSR WebUI
        </Navbar.Brand>
      </Navbar>
      <p>Connecting...</p>
    </div>
  );
};

export default LoadingScreen;
