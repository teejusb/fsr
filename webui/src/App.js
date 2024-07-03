import React, { useCallback, useEffect, useState, useRef } from 'react';

import logo from './logo.svg';
import './App.css';

import Alert from 'react-bootstrap/Alert'
import Navbar from 'react-bootstrap/Navbar'
import Nav from 'react-bootstrap/Nav'
import NavDropdown from 'react-bootstrap/NavDropdown'

import Container from 'react-bootstrap/Container'
import Row from 'react-bootstrap/Row'
import Col from 'react-bootstrap/Col'

import Form from 'react-bootstrap/Form'
import Button from 'react-bootstrap/Button'
import ToggleButton from 'react-bootstrap/ToggleButton'

import {
  BrowserRouter as Router,
  Switch,
  Route,
  Link
} from "react-router-dom";

// Maximum number of historical sensor values to retain
const MAX_SIZE = 1000;

// Returned `defaults` property will be undefined if the defaults are loading or reloading.
// Call `reloadDefaults` to clear the defaults and reload from the server.
function useDefaults() {
  const [defaults, setDefaults] = useState(undefined);

  const reloadDefaults = useCallback(() => setDefaults(undefined), [setDefaults]);

  // Load defaults at mount and reload any time they are cleared.
  useEffect(() => {
    let cleaningUp = false;
    let timeoutId = 0;

    const getDefaults = () => {
      clearTimeout(timeoutId);
      fetch('/defaults').then(res => res.json()).then(data => {
        if (!cleaningUp) {
          setDefaults(data);
        }
      }).catch(reason => {
        if (!cleaningUp) {
          timeoutId = setTimeout(getDefaults, 1000);
        }
      });
    }

    if (!defaults) {
      getDefaults();
    }

    return () => {
      cleaningUp = true;
      clearTimeout(timeoutId);
    };
  }, [defaults]);

  return { defaults, reloadDefaults };
}

// returns { emit, isWsReady, webUIDataRef, wsCallbacksRef }
// webUIDataRef tracks values as well as thresholds.
// Use emit to send events to the server.
// isWsReady indicates that the websocket is connected and has received
// its first values reading from the server.

// onCloseWs is called when the websocket closes for any reason,
// unless the hooks is already doing effect cleanup.

// defaults is expected to be undefined if defaults are loading or reloading.
// The expectation is that onCloseWs is used to reload default thresholds
// and provide new ones to trigger a new connection.
function useWsConnection({ defaults, onCloseWs }) {
  const [isWsReady, setIsWsReady] = useState(false);

  // Some values such as sensor readings are stored in a mutable array in a ref so that
  // they are not subject to the React render cycle, for performance reasons.
  const webUIDataRef = useRef({

    // A history of the past 'MAX_SIZE' values fetched from the backend.
    // Used for plotting and displaying live values.
    // We use a cyclical array to save memory.
    curValues: [],
    oldest: 0,

    // Keep track of the current thresholds fetched from the backend.
    curThresholds: [],
  });

  const wsRef = useRef();
  const wsCallbacksRef = useRef({});

  const emit = useCallback((msg) => {
    // App should wait for isWsReady to send messages.
    if (!wsRef.current || !isWsReady) {
      throw new Error("emit() called when isWsReady !== true.");
    }

    wsRef.current.send(JSON.stringify(msg));
  }, [isWsReady, wsRef]);

  wsCallbacksRef.current.values = function(msg) {
    const webUIData = webUIDataRef.current;
    if (webUIData.curValues.length < MAX_SIZE) {
      webUIData.curValues.push(msg.values);
    } else {
      webUIData.curValues[webUIData.oldest] = msg.values;
      webUIData.oldest = (webUIData.oldest + 1) % MAX_SIZE;
    }
  };

  wsCallbacksRef.current.thresholds = function(msg) {
    // Modify thresholds array in place instead of replacing it so that animation loops can have a stable reference.
    webUIDataRef.current.curThresholds.length = 0;
    webUIDataRef.current.curThresholds.push(...msg.thresholds);
  };

  useEffect(() => {
    let cleaningUp = false;
    const webUIData = webUIDataRef.current;

    if (!defaults) {
      // If defaults are loading or reloading, don't connect.
      return;
    }

    // Ensure values history reset and default thresholds are set.
    webUIData.curValues.length = 0;
    webUIData.curValues.push(new Array(defaults.thresholds.length).fill(0));
    webUIData.oldest = 0;
    webUIDataRef.current.curThresholds.length = 0;
    webUIDataRef.current.curThresholds.push(...defaults.thresholds);

    const ws = new WebSocket('ws://' + window.location.host + '/ws');
    wsRef.current = ws;

    ws.addEventListener('open', function(ev) {
      setIsWsReady(true);
    });
    
    ws.addEventListener('error', function(ev) {
      ws.close();
    });

    ws.addEventListener('close', function(ev) {
      if (!cleaningUp) {
        onCloseWs();
      }
    });

    ws.addEventListener('message', function(ev) {
      const data = JSON.parse(ev.data)
      const action = data[0];
      const msg = data[1];

      if (wsCallbacksRef.current[action]) {
        wsCallbacksRef.current[action](msg);
      }
    });

    return () => {
      cleaningUp = true;
      setIsWsReady(false);
      ws.close();
    };
  }, [defaults, onCloseWs]);

  return { emit, isWsReady, webUIDataRef, wsCallbacksRef };
}

// An interactive display of the current values obtained by the backend.
// Also has functionality to manipulate thresholds.
function ValueMonitor(props) {
  const { emit, index, webUIDataRef } = props;
  const thresholdLabelRef = React.useRef(null);
  const valueLabelRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const curValues = webUIDataRef.current.curValues;
  const curThresholds = webUIDataRef.current.curThresholds;

  const EmitValue = useCallback((val) => {
    // Send back all the thresholds instead of a single value per sensor. This is in case
    // the server restarts where it would be nicer to have all the values in sync.
    // Still send back the index since we want to update only one value at a time
    // to the microcontroller.
    emit(['update_threshold', curThresholds, index]);
  }, [curThresholds, emit, index])

  function Decrement(e) {
    const val = curThresholds[index] - 1;
    if (val >= 0) {
      curThresholds[index] = val;
      EmitValue(val);
    }
  }

  function Increment(e) {
    const val = curThresholds[index] + 1;
    if (val <= 1023) {
      curThresholds[index] = val
      EmitValue(val);
    }
  }

  useEffect(() => {
    let requestId;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

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
      curThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      is_drag = true;
    });

    canvas.addEventListener('mouseup', function(e) {
      EmitValue(curThresholds[index]);
      is_drag = false;
    });

    canvas.addEventListener('mousemove', function(e) {
      if (is_drag) {
        let pos = getMousePos(canvas, e);
        curThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      }
    });

    // Touch Events
    canvas.addEventListener('touchstart', function(e) {
      let pos = getTouchPos(canvas, e);
      curThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      is_drag = true;
    });

    canvas.addEventListener('touchend', function(e) {
      // We don't need to get the 
      EmitValue(curThresholds[index]);
      is_drag = false;
    });

    canvas.addEventListener('touchmove', function(e) {
      if (is_drag) {
        let pos = getTouchPos(canvas, e);
        curThresholds[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      }
    });

    const setDimensions = () => {
      // Adjust DPI so that all the edges are smooth during scaling.
      const dpi = window.devicePixelRatio || 1;

      canvas.width = canvas.clientWidth * dpi;
      canvas.height = canvas.clientHeight * dpi;
    };

    setDimensions();
    window.addEventListener('resize', setDimensions);

    // This is default React CSS font style.
    const bodyFontFamily = window.getComputedStyle(document.body).getPropertyValue("font-family");
    const valueLabel = valueLabelRef.current;
    const thresholdLabel = thresholdLabelRef.current;

    // cap animation to 60 FPS (with slight leeway because monitor refresh rates are not exact)
    const minFrameDurationMs = 1000 / 60.1;
    var previousTimestamp;

    const render = (timestamp) => {
      const oldest = webUIDataRef.current.oldest;

      if (previousTimestamp && (timestamp - previousTimestamp) < minFrameDurationMs) {
        requestId = requestAnimationFrame(render);
        return;
      }
      previousTimestamp = timestamp;

      // Get the latest value. This is either last element in the list, or based off of
      // the circular array.
      let currentValue = 0;
      if (curValues.length < MAX_SIZE) {
        currentValue = curValues[curValues.length-1][index];
      } else {
        currentValue = curValues[((oldest - 1) % MAX_SIZE + MAX_SIZE) % MAX_SIZE][index];
      }

      // Add background fill.
      let grd = ctx.createLinearGradient(canvas.width/2, 0, canvas.width/2 ,canvas.height);
      if (currentValue >= curThresholds[index]) {
        grd.addColorStop(0, 'lightblue');
        grd.addColorStop(1, 'blue');
      } else {
        grd.addColorStop(0, 'lightblue');
        grd.addColorStop(1, 'gray');
      }
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Cur Value Label
      valueLabel.innerText = currentValue;

      // Bar
      const maxHeight = canvas.height;
      const position = Math.round(maxHeight - currentValue/1023 * maxHeight);
      grd = ctx.createLinearGradient(canvas.width/2, canvas.height, canvas.width/2, position);
      grd.addColorStop(0, 'orange');
      grd.addColorStop(1, 'red');
      ctx.fillStyle = grd;
      ctx.fillRect(canvas.width/4, position, canvas.width/2, canvas.height);

      // Threshold Line
      const threshold_height = 3
      const threshold_pos = (1023-curThresholds[index])/1023 * canvas.height;
      ctx.fillStyle = "black";
      ctx.fillRect(0, threshold_pos-Math.floor(threshold_height/2), canvas.width, threshold_height);

      // Threshold Label
      thresholdLabel.innerText = curThresholds[index];
      ctx.font = "30px " + bodyFontFamily;
      ctx.fillStyle = "black";
      if (curThresholds[index] > 990) {
        ctx.textBaseline = 'top';
      } else {
        ctx.textBaseline = 'bottom';
      }
      ctx.fillText(curThresholds[index].toString(), 0, threshold_pos + threshold_height + 1);

      requestId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(requestId);
      window.removeEventListener('resize', setDimensions);
    };
  }, [EmitValue, curThresholds, curValues, index, webUIDataRef]);

  return(
    <Col className="ValueMonitor-col">
      <div className="ValueMonitor-buttons">
        <Button variant="light" size="sm" onClick={Decrement}><b>-</b></Button>
        <span> </span>
        <Button variant="light" size="sm" onClick={Increment}><b>+</b></Button>
      </div>
      <Form.Label className="ValueMonitor-label" ref={thresholdLabelRef}>0</Form.Label>
      <Form.Label className="ValueMonitor-label" ref={valueLabelRef}>0</Form.Label>
      <canvas
        className="ValueMonitor-canvas"
        ref={canvasRef}
      />
    </Col>
  );
}

function ValueMonitors(props) {
  const { numSensors } = props;
  return (
    <header className="App-header">
      <Container fluid style={{border: '1px solid white', height: '100vh'}}>
        <Row className="ValueMonitor-row">
          {props.children}
        </Row>
      </Container>
      <style>
        {`
        .ValueMonitor-col {
          width: ${100 / numSensors}%;
        }
        /* 15 + 15 is left and right padding (from bootstrap col class). */
        /* 75 is the minimum desired width of the canvas. */
        /* If there is not enough room for all columns and padding to fit, reduce padding. */
        @media (max-width: ${numSensors * (15 + 15 + 75)}px) {
          .ValueMonitor-col {
            padding-left: 1px;
            padding-right: 1px;
          }
        }
        `}
      </style>
    </header>
  );
}

function Plot(props) {
  const canvasRef = React.useRef(null);
  const numSensors = props.numSensors;
  const webUIDataRef = props.webUIDataRef;
  const [display, setDisplay] = useState(new Array(numSensors).fill(true));
  // `buttonNames` is only used if the number of sensors matches the number of button names.
  const buttonNames = ['Left', 'Down', 'Up', 'Right'];
  const curValues = webUIDataRef.current.curValues;
  const curThresholds = webUIDataRef.current.curThresholds;

  // Color values for sensors
  const degreesPerSensor = 360 / numSensors;
  const colors = [...Array(numSensors)].map((_, i) => `hsl(${degreesPerSensor * i}, 100%, 40%)`);
  const darkColors = [...Array(numSensors)].map((_, i) => `hsl(${degreesPerSensor * i}, 100%, 35%)`)

  useEffect(() => {
    let requestId;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const setDimensions = () => {
      // Adjust DPI so that all the edges are smooth during scaling.
      const dpi = window.devicePixelRatio || 1;

      canvas.width = canvas.clientWidth * dpi;
      canvas.height = canvas.clientHeight * dpi;
    };

    setDimensions();
    window.addEventListener('resize', setDimensions);

    // This is default React CSS font style.
    const bodyFontFamily = window.getComputedStyle(document.body).getPropertyValue("font-family");

    function drawDashedLine(pattern, spacing, y, width) {
      ctx.beginPath();
      ctx.setLineDash(pattern);
      ctx.moveTo(spacing, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // cap animation to 60 FPS (with slight leeway because monitor refresh rates are not exact)
    const minFrameDurationMs = 1000 / 60.1;
    var previousTimestamp;

    const render = (timestamp) => {
      const oldest = webUIDataRef.current.oldest;

      if (previousTimestamp && (timestamp - previousTimestamp) < minFrameDurationMs) {
        requestId = requestAnimationFrame(render);
        return;
      }
      previousTimestamp = timestamp;

      // Add background fill.
      ctx.fillStyle = "#f8f9fa";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Border
      const spacing = 10;
      const box_width = canvas.width-spacing*2;
      const box_height = canvas.height-spacing*2
      ctx.strokeStyle = 'darkgray';
      ctx.beginPath();
      ctx.rect(spacing, spacing, box_width, box_height);
      ctx.stroke();

      // Draw the divisions in the plot.
      // Major Divisions will be 2 x minor_divison.
      const minor_division = 100;
      for (let i = 1; i*minor_division < 1023; ++i) {
        const pattern = i % 2 === 0 ? [20, 5] : [5, 10];
        drawDashedLine(pattern, spacing,
          box_height-(box_height * (i*minor_division)/1023) + spacing, box_width + spacing);
      }

      // Plot the line graph for each of the sensors.
      const px_per_div = box_width/MAX_SIZE;
      let plot_nums = 0;
      for (let i = 0; i < numSensors; ++i) {
        if (display[i]) {
          ++plot_nums;
        }
      }
      let k = -1;
      for (let i = 0; i < numSensors; ++i) {
        if (display[i]) {
          ++k;
          ctx.beginPath();
          ctx.setLineDash([]);
          ctx.strokeStyle = colors[i];
          ctx.lineWidth = 2;
          for (let j = 0; j < MAX_SIZE; ++j) {
            if (j === curValues.length) { break; }
            if (j === 0) {
              ctx.moveTo(spacing,
                box_height - box_height * curValues[(j + oldest) % MAX_SIZE][i]/1023 / plot_nums - k / plot_nums * box_height + spacing);
            } else {
              ctx.lineTo(px_per_div*j + spacing,
                box_height - box_height * curValues[(j + oldest) % MAX_SIZE][i]/1023 / plot_nums - k / plot_nums * box_height + spacing);
            }
          }
          ctx.stroke();
        }
      }

      // Display the current thresholds.
      k = -1;
      for (let i = 0; i < numSensors; ++i) {
        if (display[i]) {
          ++k;
          ctx.beginPath();
          ctx.setLineDash([]);
          ctx.strokeStyle = darkColors[i];
          ctx.lineWidth = 2;
          ctx.moveTo(spacing, box_height - box_height * curThresholds[i]/1023 / plot_nums - k / plot_nums * box_height + spacing);
          ctx.lineTo(box_width + spacing, box_height - box_height * curThresholds[i]/1023 / plot_nums - k / plot_nums * box_height + spacing);
          ctx.stroke();
        }
      }

      // Display the current value for each of the sensors.
      ctx.font = "30px " + bodyFontFamily;
      for (let i = 0; i < numSensors; ++i) {
        if (display[i]) {
          ctx.fillStyle = colors[i];
          if (curValues.length < MAX_SIZE) {
            ctx.fillText(curValues[curValues.length-1][i], 100 + i * 100, 100);
          } else {
            ctx.fillText(
              curValues[((oldest - 1) % MAX_SIZE + MAX_SIZE) % MAX_SIZE][i], 100 + i * 100, 100);
          }
        }
      }

      requestId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(requestId);
      window.removeEventListener('resize', setDimensions);
    };
  }, [colors, curThresholds, curValues, darkColors, display, numSensors, webUIDataRef]);

  const ToggleLine = (index) => {
    setDisplay(display => {
      const updated = [...display];
      updated[index] = !updated[index];
      return updated;
    });
  };

  const toggleButtons = [];
  for (let i = 0; i < numSensors; i++) {
    toggleButtons.push(
      <ToggleButton
        className="ToggleButton-plot-sensor"
        key={i}
        type="checkbox"
        checked={display[i]}
        variant={display[i] ? "light" : "secondary"}
        size="sm"
        onChange={() => ToggleLine(i)}
      >
        <b style={{color: display[i] ? darkColors[i] : "#f8f9fa"}}>
          {numSensors === buttonNames.length ? buttonNames[i] : i}
        </b>
      </ToggleButton>
    );
  }

  return (
    <header className="App-header">
      <Container fluid style={{border: '1px solid white', height: '100vh'}}>
        <Row>
          <Col style={{height: '9vh', paddingTop: '2vh'}}>
            <span>Display: </span>
            {toggleButtons}
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

function FSRWebUI(props) {
  const { emit, defaults, webUIDataRef, wsCallbacksRef } = props;
  const numSensors = defaults.thresholds.length;
  const [profiles, setProfiles] = useState(defaults.profiles);
  const [activeProfile, setActiveProfile] = useState(defaults.cur_profile);
  const [showPersistedAlert, setShowPersistedAlert] = useState(false);
  useEffect(() => {
    const wsCallbacks = wsCallbacksRef.current;

    wsCallbacks.get_profiles = function(msg) {
      setProfiles(msg.profiles);
    };
    wsCallbacks.get_cur_profile = function(msg) {
      setActiveProfile(msg.cur_profile);
    };
    wsCallbacks.thresholds_persisted = function (msg) {
      setShowPersistedAlert(true);
    };

    return () => {
      delete wsCallbacks.get_profiles;
      delete wsCallbacks.get_cur_profile;
      delete wsCallbacks.thresholds_persisted;
    };
  }, [profiles, wsCallbacksRef]);

  function AddProfile(e) {
    // Only add a profile on the enter key.
    if (e.keyCode === 13) {
      emit(['add_profile', e.target.value, webUIDataRef.current.curThresholds]);
      // Reset the text box.
      e.target.value = "";
    }
    return false;
  }

  function RemoveProfile(e) {
    // The X button is inside the Change Profile button, so stop the event from bubbling up and triggering the ChangeProfile handler.
    e.stopPropagation();
    // Strip out the "X " added by the button.
    const profile_name = e.target.parentNode.innerText.replace('X ', '');
    emit(['remove_profile', profile_name]);
  }

  function PersistThresholds(e) {
    emit(['persist_thresholds']);
  }

  function ChangeProfile(e) {
    // Strip out the "X " added by the button.
    const profile_name = e.target.innerText.replace('X ', '');
    emit(['change_profile', profile_name]);
  }

  return (
    <div className="App">
      <Router>
        <>
          <Navbar bg="light">
            <Navbar.Brand as={Link} to="/">FSR WebUI</Navbar.Brand>
            <Nav>
              <Nav.Item>
                <Nav.Link as={Link} to="/plot">Plot</Nav.Link>
              </Nav.Item>
            </Nav>
            <Button onClick={PersistThresholds}>Persist thresholds</Button>
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
          <Alert show={ showPersistedAlert } variant="success" dismissible onClose={()=>setShowPersistedAlert(false)}>Threshold values have been persisted successfully.</Alert>
        </>
        <Switch>
          <Route exact path="/">
            <ValueMonitors numSensors={numSensors}>
              {[...Array(numSensors).keys()].map(index => (
                <ValueMonitor emit={emit} index={index} key={index} webUIDataRef={webUIDataRef} />)
              )}
            </ValueMonitors>
          </Route>
          <Route path="/plot">
            <Plot numSensors={numSensors} webUIDataRef={webUIDataRef} />
          </Route>
        </Switch>
      </Router>
    </div>
  );
}

function LoadingScreen() {
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

function App() {
  const { defaults, reloadDefaults } = useDefaults();
  const {
    emit,
    isWsReady,
    webUIDataRef,
    wsCallbacksRef
  } = useWsConnection({ defaults, onCloseWs: reloadDefaults });

  if (defaults && isWsReady) {
    return (
      <FSRWebUI
        defaults={defaults}
        emit={emit}
        webUIDataRef={webUIDataRef}
        wsCallbacksRef={wsCallbacksRef}
      />
    );
  } else {
    return <LoadingScreen />
  }
}

export default App;
