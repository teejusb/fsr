import React from 'react'
import Navbar from 'react-bootstrap/Navbar'

const LoadingScreen = () => {
  return (
    <div style={{ color: "white", height: "100vh", width: "100vw" }}>
      <Navbar bg="light">
        <Navbar.Brand as={"span"} to="/">FSR WebUI</Navbar.Brand>
      </Navbar>
      <div style={{
        backgroundColor: "#282c34",
        border: "1px solid white",
        fontSize: "1.25rem",
        padding: "0.5rem 1rem",
        height: "96vh"
      }}>
        Connecting...
      </div>
    </div>
  );
}

export default LoadingScreen;