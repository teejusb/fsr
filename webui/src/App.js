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

const socket = io({transport: ["websocket"]});

// Keep track of the current thresholds fetched from the backend.
// Make it global since it's used by many components.
let kCurThresholds = [0, 0, 0, 0];

// A history of the past 'max_size' values fetched from the backend.
// Used for plotting and displaying live values.
// We use a cyclical array to save memory.
let kCurValues = [[0, 0, 0, 0]]
const max_size = 1000;
let oldest = 0;

// Add the appropriate socket handlers for the above two globals.
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

// An interactive display of the current values obtained by the backend.
// Also has functionality to manipulate thresholds.
function ValueMonitor(props) {
  const index = parseInt(props.index)
  const thresholdLabelRef = React.useRef(null);
  const valueLabelRef = React.useRef(null);
  const canvasRef = React.useRef(null);

  function EmitValue(val) {
    // Send back all the thresholds instead of a single value per sensor. This is in case
    // the server restarts where it would be nicer to have all the values in sync.
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

    function getMousePos(canvas, e) {
      const rect = canvas.getBoundingClientRect();
      const dpi = window.devicePixelRatio || 1;
      return {
        x: (e.clientX - rect.left) * dpi,
        y: (e.clientY - rect.top) * dpi
      };
    }

    function getTouchPos(canvas, e) {
      const rect = canvas.getBoundingClientRect();
      const dpi = window.devicePixelRatio || 1;
      return {
        x: (e.targetTouches[0].pageX - rect.left - window.pageXOffset) * dpi,
        y: (e.targetTouches[0].pageY - rect.top - window.pageYOffset) * dpi
      };
    }
    // Change the thresholds while dragging, but only emit on release.
    let is_drag = false;

    // Mouse Events
    canvas.addEventListener('mousedown', function(e) {
      let pos = getMousePos(canvas, e);
      kCurThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      is_drag = true;
    });

    canvas.addEventListener('mouseup', function(e) {
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
      let pos = getTouchPos(canvas, e);
      kCurThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      is_drag = true;
    });

    canvas.addEventListener('touchend', function(e) {
      // We don't need to get the 
      EmitValue(kCurThresholds[index]);
      is_drag = false;
    });

    canvas.addEventListener('touchmove', function(e) {
      if (is_drag) {
        let pos = getTouchPos(canvas, e);
        kCurThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      }
    });

    const render = () => {
      // ********** Canvas setup **********
      // This has to be here in case the user resizes the window.
      // Adjust DPI so that all the edges are smooth during scaling.
      const dpi = window.devicePixelRatio || 1;
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

      // Get the latest value. This is either last element in the list, or based off of
      // the circular array.
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

      // Threshold Line
      const threshold_height = 3
      const threshold_pos = (1023-kCurThresholds[index])/1023 * canvas.height;
      ctx.fillStyle = "black";
      ctx.fillRect(0, threshold_pos-Math.floor(threshold_height/2), canvas.width, threshold_height);

      // Threshold Label
      const thresholdLabel = thresholdLabelRef.current;
      thresholdLabel.innerHTML = kCurThresholds[index];
      // This is default React CSS font style.
      const bodyFontFamily = window.getComputedStyle(document.body).getPropertyValue("font-family");
      ctx.font = "30px " + bodyFontFamily;
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
      cancelAnimationFrame(requestId);
    };
  // Intentionally disable the lint errors.
  // EmitValue and index don't need to be in the dependency list as we only want this to 
  // run once. The canvas will automatically update via requestAnimationFrame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return(
    <Col style={{height: '75vh', paddingTop: '1vh'}}>
      <Button variant="light" size="sm" onClick={Decrement}><b>-</b></Button>
      <span> </span>
      <Button variant="light" size="sm" onClick={Increment}><b>+</b></Button>
      <br />
      <Form.Label ref={thresholdLabelRef}>0</Form.Label>
      <br />
      <Form.Label ref={valueLabelRef}>0</Form.Label>
      <canvas
        ref={canvasRef}
        style={{border: '1px solid white', width: '100%', height: '100%', touchAction: "none"}} />
    </Col>
  );
}

function WebUI() {
  return (
    <header className="App-header">
      <Container fluid style={{border: '1px solid white', height: '100vh'}}>
        <Row>
          <ValueMonitor index="0"/>
          <ValueMonitor index="1"/>
          <ValueMonitor index="2"/>
          <ValueMonitor index="3"/>
        </Row>
      </Container>
    </header>
  );
}

function Plot() {
  const canvasRef = React.useRef(null);
  const colors = ['red', 'orange', 'green', 'blue'];
  const display = [true, true, true, true];

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

      // Border
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

      // Draw the divisions in the plot.
      // Major Divisions will be 2 x minor_divison.
      const minor_division = 100;
      for (let i = 1; i*minor_division < 1023; ++i) {
        const pattern = i % 2 === 0 ? [20, 5] : [5, 10];
        drawDashedLine(ctx, pattern, spacing,
          box_height-(box_height * (i*minor_division)/1023) + spacing, box_width + spacing);
      }

      // Plot the line graph for each of the sensors.
      const px_per_div = box_width/max_size;
      for (let i = 0; i < 4; ++i) {
        if (display[i]) {
          ctx.beginPath();
          ctx.setLineDash([]);
          ctx.strokeStyle = colors[i];
          ctx.lineWidth = 2;
          for (let j = 0; j < max_size; ++j) {
            if (j === kCurValues.length) { break; }
            if (j === 0) {
              ctx.moveTo(spacing,
                box_height - box_height * kCurValues[(j + oldest) % max_size][i]/1023 + spacing);
            } else {
              ctx.lineTo(px_per_div*j + spacing,
                box_height - box_height * kCurValues[(j + oldest) % max_size][i]/1023 + spacing);
            }
          }
          ctx.stroke();
        }
      }

      // Display the current thresholds.
      for (let i = 0; i < 4; ++i) {
        if (display[i]) {
          ctx.beginPath();
          ctx.setLineDash([]);
          ctx.strokeStyle = 'dark' + colors[i];
          ctx.lineWidth = 2;
          ctx.moveTo(spacing, box_height - box_height * kCurThresholds[i]/1023 + spacing);
          ctx.lineTo(box_width + spacing, box_height - box_height * kCurThresholds[i]/1023 + spacing);
          ctx.stroke();
        }
      }

      // Display the current value for each of the sensors.
      // This is default React CSS font style.
      const bodyFontFamily = window.getComputedStyle(document.body).getPropertyValue("font-family");
      ctx.font = "30px " + bodyFontFamily;
      for (let i = 0; i < 4; ++i) {
        if (display[i]) {
          ctx.fillStyle = colors[i];
          if (kCurValues.length < max_size) {
            ctx.fillText(kCurValues[kCurValues.length-1][i], 100 + i * 100, 100);
          } else {
            ctx.fillText(
              kCurValues[((oldest - 1) % max_size + max_size) % max_size][i], 100 + i * 100, 100);
          }
        }
      }

      requestId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(requestId);
    };
  }, [colors, display]);

  function ToggleLine(index) {
    display[index] = !display[index];
  }

  return (
    <header className="App-header">
      <Container fluid style={{border: '1px solid white', height: '100vh'}}>
        <Row>
          <Col style={{height: '9vh', paddingTop: '2vh'}}>
            <span>Display: </span>
            <Button variant="light" size="sm" onClick={() => ToggleLine(0)}>
              <b style={{color: colors[0]}}>Left</b>
            </Button>
            <span> </span>
            <Button variant="light" size="sm" onClick={() => ToggleLine(1)}>
              <b style={{color: colors[1]}}>Down</b>
            </Button>
            <span> </span>
            <Button variant="light" size="sm" onClick={() => ToggleLine(2)}>
              <b style={{color: colors[2]}}>Up</b>
            </Button>
            <span> </span>
            <Button variant="light" size="sm" onClick={() => ToggleLine(3)}>
              <b style={{color: colors[3]}}>Right</b>
            </Button>
          </Col>
        </Row>
        <Row>
          <Col style={{height: '86vh'}}>
            <canvas
              ref={canvasRef}
              style={{border: '1px solid white', width: '100%', height: '100%', touchAction: "none"}} />
          </Col>
        </Row>
      </Container>
    </header>
  );
}

function App() {
  const [fetched, setFetched] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState('');

  useEffect(() => {
    // Fetch all the default values the first time we load the page.
    // We will re-render after everything is fetched.
    if (!fetched) {
      fetch('/defaults').then(res => res.json()).then(data => {
          setProfiles(data.profiles);
          setActiveProfile(data.cur_profile);
          kCurThresholds = data.thresholds;
          setFetched(true);
      });
    }

    socket.on('get_profiles', function(msg) {
      setProfiles(msg.profiles);
    });
    socket.on('get_cur_profile', function(msg) {
      setActiveProfile(msg.cur_profile);
    });

    return () => {
      socket.off('get_profiles');
      socket.off('get_cur_profile');
    };
  }, [fetched, profiles, activeProfile]);

  function AddProfile(e) {
    // Only add a profile on the enter key.
    if (e.keyCode === 13) {
      socket.emit('add_profile', e.target.value, kCurThresholds);
      // Reset the text box.
      e.target.value = "";
    }
    return false;
  }

  function RemoveProfile(e) {
    // Strip out the "X " added by the button.
    const profile_name = e.target.parentNode.innerText.replace('X ', '');
    socket.emit('remove_profile', profile_name);
  }

  function ChangeProfile(e) {
    // Strip out the "X " added by the button.
    const profile_name = e.target.innerText.replace('X ', '');
    socket.emit('change_profile', profile_name);
  }

  // Don't render anything until the defaults are fetched.
  return (
    fetched ?
      <div className="App">
        <Router>
          <Navbar bg="light">
            <Navbar.Brand as={Link} to="/">FSR WebUI</Navbar.Brand>
            <Nav>
              <Nav.Item>
                <Nav.Link as={Link} to="/plot">Plot</Nav.Link>
              </Nav.Item>
            </Nav>
            <Nav className="ml-auto">
              <NavDropdown alignRight title="Profile" id="collasible-nav-dropdown">
                {profiles.map(function(profile) {
                  if (profile === activeProfile) {
                    return(
                      <NavDropdown.Item key={profile} style={{paddingLeft: "0.5rem"}}
                          onClick={ChangeProfile} active>
                        <Button variant="light" onClick={RemoveProfile}>X</Button>{' '}{profile}
                      </NavDropdown.Item>
                    );
                  } else {
                    return(
                      <NavDropdown.Item key={profile} style={{paddingLeft: "0.5rem"}}
                          onClick={ChangeProfile}>
                        <Button variant="light" onClick={RemoveProfile}>X</Button>{' '}{profile}
                      </NavDropdown.Item>
                    );
                  }
                })}
                <NavDropdown.Divider />
                <Form inline onSubmit={(e) => e.preventDefault()}>
                  <Form.Control
                      onKeyDown={AddProfile}
                      style={{marginLeft: "0.5rem", marginRight: "0.5rem"}}
                      type="text"
                      placeholder="New Profile" />
                </Form>
              </NavDropdown>
            </Nav>
          </Navbar>
          <Switch>
            <Route exact path="/">
              <WebUI />
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