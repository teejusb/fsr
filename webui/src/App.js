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
  Link
} from "react-router-dom";

const socket = io("127.0.0.1:5000");

let kCurThresholds = [0, 0, 0, 0];
let kCurValues = [[0, 0, 0, 0]]
const max_size = 1000;
let oldest = 0;

socket.on('get_values', function(msg) {
  if (kCurValues.length < max_size) {
    kCurValues.push(msg.values);
  } else {
    kCurValues[oldest] = msg.values;
    oldest = (oldest + 1) % max_size;
  }
});

socket.on('thresholds', function(msg) {
  kCurThresholds = msg.thresholds;
});

function Canvas(props) {
  const index = parseInt(props.index)
  const thresholdLabelRef = React.useRef(null);
  const valueLabelRef = React.useRef(null);
  const canvasRef = React.useRef(null);

  function EmitValue(val) {
    // Send back all the thresholds, in case the server restarts it would be
    // nicer to have all the values in sync.
    // Still send back the index since we want to update only one value at a time
    // to the microcontroller.
    socket.emit('update_threshold', kCurThresholds, index);
  }

  function Decrement(e) {
    const val = kCurThresholds[index] - 1;
    if (val >= 0) {
      kCurThresholds[index] = val;
      EmitValue(val);
    }
  }
  function Increment(e) {
    const val = kCurThresholds[index] + 1;
    if (val <= 1023) {
      kCurThresholds[index] = val
      EmitValue(val);
    }
  }

  useEffect(() => {
    let requestId;

    const canvas = canvasRef.current;

    // Change thresholds on drag.
    function getMousePos(canvas, e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
    let is_drag = false;

    // Mouse Events
    canvas.addEventListener('mousedown', function(e) {
      let pos = getMousePos(canvas, e);
      kCurThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      is_drag = true;
    });

    canvas.addEventListener('mouseup', function(e) {
      let pos = getMousePos(canvas, e);
      kCurThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      EmitValue(kCurThresholds[index]);
      is_drag = false;
    });

    canvas.addEventListener('mousemove', function(e) {
      if (is_drag) {
        let pos = getMousePos(canvas, e);
        kCurThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      }
    });

    // Touch Events
    canvas.addEventListener('touchstart', function(e) {
      let pos = getMousePos(canvas, e);
      kCurThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      is_drag = true;
    });

    canvas.addEventListener('touchend', function(e) {
      let pos = getMousePos(canvas, e);
      kCurThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      EmitValue(kCurThresholds[index]);
      is_drag = false;
    });

    canvas.addEventListener('touchmove', function(e) {
      if (is_drag) {
        let pos = getMousePos(canvas, e);
        kCurThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      }
    });

    const render = () => {
      // ********** Canvas setup **********
      // This has to be here in case the user resizes the window.
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
      // **********************************

      let currentValue = 0;
      if (kCurValues.length < max_size) {
        currentValue = kCurValues[kCurValues.length-1][index];
      } else {
        currentValue = kCurValues[((oldest - 1) % max_size + max_size) % max_size][index];
      }

      // Add background fill.
      const ctx = canvas.getContext('2d');
      let grd = ctx.createLinearGradient(canvas.width/2, 0, canvas.width/2 ,canvas.height);
      if (currentValue >= kCurThresholds[index]) {
        grd.addColorStop(0, 'lightblue');
        grd.addColorStop(1, 'blue');
      } else {
        grd.addColorStop(0, 'lightblue');
        grd.addColorStop(1, 'gray');
      }
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Cur Value Label
      const valueLabel = valueLabelRef.current;
      valueLabel.innerHTML = currentValue;

      // Bar
      const maxHeight = canvas.height;
      const position = maxHeight - currentValue/1023 * maxHeight;
      grd = ctx.createLinearGradient(canvas.width/2, canvas.height, canvas.width/2, position);
      grd.addColorStop(0, 'orange');
      grd.addColorStop(1, 'red');
      ctx.fillStyle = grd;
      ctx.fillRect(canvas.width/4, position, canvas.width/2, canvas.height);

      // Threshold
      const threshold_height = 3
      const threshold_pos = (1023-kCurThresholds[index])/1023 * canvas.height;
      ctx.fillStyle = "black";
      ctx.fillRect(0, threshold_pos-Math.floor(threshold_height/2),  canvas.width, threshold_height);

      // Threshold Label
      const thresholdLabel = thresholdLabelRef.current;
      thresholdLabel.innerHTML = kCurThresholds[index];
      ctx.font = "30px Arial";
      ctx.fillStyle = "black";
      if (kCurThresholds[index] > 990) {
        ctx.textBaseline = 'top';
      } else {
        ctx.textBaseline = 'bottom';
      }
      ctx.fillText(kCurThresholds[index].toString(), 0, threshold_pos + threshold_height + 1);

      requestId = requestAnimationFrame(render);
    };

    render();

    return () => {
      socket.off('newnumber' + index);
      cancelAnimationFrame(requestId);
    };
  }, [index]);

  return(
    <Col style={{height: '75vh', paddingTop: '1vh'}}>
      <Button variant="light" size="md" onClick={Decrement}><b>-</b></Button>
      <span> </span>
      <Button variant="light" size="md" onClick={Increment}><b>+</b></Button>
      <br />
      <Form.Label ref={thresholdLabelRef}>0</Form.Label>
      <br />
      <Form.Label ref={valueLabelRef}>0</Form.Label>
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

function Plot() {
  const canvasRef = React.useRef(null);

  useEffect(() => {
    let requestId;
    const canvas = canvasRef.current;

    const render = () => {
      // ********** Canvas setup **********
      // This has to be here in case the user resizes the window.
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
      // **********************************

      // Add background fill.
      const ctx = canvas.getContext('2d');
      let grd = ctx.createLinearGradient(canvas.width/2, 0, canvas.width/2 ,canvas.height);
      grd.addColorStop(0, 'white');
      grd.addColorStop(1, 'lightgray');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const spacing = 10;
      const box_width = canvas.width-spacing*2;
      const box_height = canvas.height-spacing*2
      ctx.beginPath();
      ctx.rect(spacing, spacing, box_width, box_height);
      ctx.stroke();

      function drawDashedLine(ctx, pattern, spacing, y, width) {
        ctx.beginPath();
        ctx.setLineDash(pattern);
        ctx.moveTo(spacing, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const main_division = 100;
      for (let i = 1; i*main_division < 1023; ++i) {
        const pattern = i % 2 === 0 ? [20, 5] : [5, 10];
        drawDashedLine(ctx, pattern, spacing, box_height-(box_height * (i*main_division)/1023), box_width + spacing);
      }

      const px_per_div = box_width/max_size;
      const colors = ['red', 'orange', 'green', 'blue'];
      for (let j = 0; j < 4; ++j) {
        ctx.beginPath();
        ctx.setLineDash([]);
        ctx.strokeStyle = colors[j];
        for (let i = 0; i < max_size; ++i) {
          if (i === kCurValues.length) { break; }
          if (i === 0) {
            ctx.moveTo(px_per_div*i + spacing, box_height - box_height * kCurValues[(i + oldest) % max_size][j]/1023 + spacing);
          } else {
            ctx.lineTo(px_per_div*i + spacing, box_height - box_height * kCurValues[(i + oldest) % max_size][j]/1023 + spacing);
          }
        }
        ctx.stroke();
      }

      ctx.font = "30px Arial";
      for (let i = 0; i < 4; ++i) {
        ctx.fillStyle = colors[i];
        if (kCurValues.length < max_size) {
          ctx.fillText(kCurValues[kCurValues.length-1][i], 100 + i * 100, 100);
        } else {
          ctx.fillText(kCurValues[((oldest - 1) % max_size + max_size) % max_size][i], 100 + i * 100, 100);
        }
      }

      requestId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(requestId);
    };
  }, []);
  return (
    <header className="App-header">
      <canvas
        ref={canvasRef}
        style={{border: '1px solid white', width: '100%', height: '100%'}}
      />
    </header>
  );
}

function App() {
  const [fetched, setFetched] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    fetch('/defaults').then(res => res.json()).then(data => {
      if (!fetched) {
        setFetched(true);
      }
    });
  }, [fetched]);

  function GetTime() {
    console.log("called");
    fetch('/time').then(res => res.json()).then(data => {
      setCurrentTime(data.time);
    });
  };

  // Don't render anything until the defaults are fetched.
  return (
    fetched ?
      <div className="App">
        <Router>
          <Navbar bg="light">
            <Navbar.Brand as={Link} to="/">FSR WebUI</Navbar.Brand>
            <Nav>
              <Nav.Item>
                <Nav.Link as={Link} to="/config" onClick={GetTime}>Config</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link as={Link} to="/plot">Plot</Nav.Link>
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
              <Plot />
            </Route>
          </Switch>
        </Router>
      </div>
    :
    <></>
  );
}

export default App;