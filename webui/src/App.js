import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

import logo from './logo.svg';
import './App.css';

import Navbar from 'react-bootstrap/Navbar'
import Nav from 'react-bootstrap/Nav'
import NavDropdown from 'react-bootstrap/NavDropdown'

import Container from 'react-bootstrap/Container'
import Row from 'react-bootstrap/Row'
import Col from 'react-bootstrap/Col'

import Form from 'react-bootstrap/Form'
import Button from 'react-bootstrap/Button'

import {
  BrowserRouter as Router,
  Switch,
  Route,
} from "react-router-dom";

var kCurValues = [400, 300, 200, 800];
const socket = io.connect();

//receive details from server
socket.on('newnumber', function(msg) {
  kCurValues[0] = msg.num0;
  kCurValues[1] = msg.num1;
  kCurValues[2] = msg.num2;
  kCurValues[3] = msg.num3;
  console.log("Received numbers: " + kCurValues.toString());
});

function NavBar() {
  return (
    <Navbar bg="light">
      <Navbar.Brand href="/">FSR WebUI</Navbar.Brand>
      <Nav>
        <Nav.Item>
          <Nav.Link href="/config">Config</Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link href="/plot">Plot</Nav.Link>
        </Nav.Item>
      </Nav>
      <Nav className="ml-auto">
        <NavDropdown alignRight title="Profile" id="collasible-nav-dropdown">
          <NavDropdown.Item href="#action/3.1">Action</NavDropdown.Item>
          <NavDropdown.Item href="#action/3.2">Another action</NavDropdown.Item>
          <NavDropdown.Item href="#action/3.3">Something</NavDropdown.Item>
          <NavDropdown.Item href="#action/3.4">Separated link</NavDropdown.Item>
        </NavDropdown>
      </Nav>
    </Navbar>
  );
}

function Slider(props) {
  const [sliderVal, setSliderVal] = useState(100);

  function EmitSliderVal(val) {
    socket.emit('update_threshold', parseInt(props.index), val);
  }

  function Decrement(e) {
    const val = sliderVal - 1;
    if (val >= 0) {
      setSliderVal(val);
      EmitSliderVal(val);
    }
  }
  function Increment(e) {
    const val = sliderVal + 1;
    if (val <= 1023) {
      setSliderVal(val);
      EmitSliderVal(val);
    }
  }
  return (
    <Row>
      <Col xs="auto">
        <Form.Label>{sliderVal.toString().padStart(4, "0")}</Form.Label>
      </Col>
      <Col xs="auto">
        <Button variant="light" onClick={Decrement}><b>-</b></Button>
      </Col>
      <Col>
        <Form.Control
          type="range"
          min="0"
          max="1023"
          width="100px"
          value={sliderVal}
          custom
          onChange={e => setSliderVal(parseInt(e.target.value))}
          onMouseUp={e => EmitSliderVal(parseInt(e.target.value))}
        />
      </Col>
      <Col xs="auto">
        <Button variant="light" onClick={Increment}><b>+</b></Button>
      </Col>
    </Row>
  );
}

function Canvas(props) {
  const labelRef = React.useRef(null);
  const canvasRef = React.useRef(null);

  useEffect(() => {
    let requestId;

    const render = () => {
      const label = labelRef.current;
      const canvas = canvasRef.current;

      // Adjust DPI so that all the edges are smooth during scaling.
      const dpi = window.devicePixelRatio;
      const style = {
        height() {
          return +getComputedStyle(canvas).getPropertyValue('height').slice(0,-2);
        },
        width() {
          return +getComputedStyle(canvas).getPropertyValue('width').slice(0,-2);
        }
      }
      canvas.setAttribute('width', style.width() * dpi);
      canvas.setAttribute('height', style.height() * dpi);

      // Add background fill.
      const ctx = canvas.getContext('2d');
      let grd = ctx.createLinearGradient(canvas.width/2, 0, canvas.width/2 ,canvas.height);
      grd.addColorStop(0, 'lightblue');
      grd.addColorStop(1, 'gray');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Bar
      const maxHeight = canvas.height;
      const curValue = kCurValues[parseInt(props.index)];
      label.innerHTML = curValue;
      const position = maxHeight - curValue/1023 * maxHeight;
      grd = ctx.createLinearGradient(canvas.width/2, canvas.height, canvas.width/2, position);
      grd.addColorStop(0, 'orange');
      grd.addColorStop(1, 'red');
      ctx.fillStyle = grd;
      ctx.fillRect(canvas.width/4, position, canvas.width/2, canvas.height);

      requestId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(requestId);
    };
  });

  return(
    <Col style={{height: '75vh'}}>
      <Form.Label ref={labelRef}>0</Form.Label>
      <canvas
        ref={canvasRef}
        style={{border: '1px solid white', width: '100%', height: '100%'}}
      />
    </Col>
  );
}

function WebUI() {
  return (
    <header className="App-header">
      <Container fluid style={{border: '1px solid white', height: '100vh'}}>
        <Slider index="0"/>
        <Slider index="1"/>
        <Slider index="2"/>
        <Slider index="3"/>
        <Row>
          <Canvas index="0"/>
          <Canvas index="1"/>
          <Canvas index="2"/>
          <Canvas index="3"/>
        </Row>
      </Container>
    </header>
  );
}

function App() {
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    fetch('/time').then(res => res.json()).then(data => {
      setCurrentTime(data.time);
    });
  }, []);

  return (
    <div className="App">
      <NavBar />
      <Router>
        <Switch>
          <Route exact path="/">
            <WebUI />
          </Route>
          <Route path="/config">
            <header className="App-header">
              <p>The current time is {currentTime}.</p>
            </header>
          </Route>
          <Route path="/plot">
            <header className="App-header">
              <p>Plot</p>
            </header>
          </Route>
        </Switch>
      </Router>
    </div>
  );
}

export default App;