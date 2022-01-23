import React, { useCallback, useContext, useEffect, useState, useRef } from 'react';

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

// Maximum number of historical sensor values to retain
const max_size = 1000;

// Reference to history of current sensor values.
// The values are stored in a mutable array in a ref so that they are not
// subject to the React render cycle, for performance reasons.
// The Context is to make them easy to access from nested components.
const CurValuesRefContext = React.createContext();

// returns { curValuesRef, emit, isWsReady, wsCallbacksRef }
// curValuesRef tracks values as well as thresholds.
// Use emit to send events to the server.
// isWsReady indicates that the websocket is connected and has received
// its first values reading from the server.
// onCloseWs is called when the websocket closes for any reason,
// unless the hooks is already doing effect cleanup.
// The expectation is that onCloseWs is used to reload default thresholds
// and provide new ones to trigger a new connection.
function useWsConnection({ defaultThresholds, onCloseWs }) {
  const [isWsReady, setIsWsReady] = useState(false);

  const curValuesRef = useRef({

    // A history of the past 'max_size' values fetched from the backend.
    // Used for plotting and displaying live values.
    // We use a cyclical array to save memory.
    kCurValues: [],
    oldest: 0,

    // Keep track of the current thresholds fetched from the backend.
    kCurThresholds: [...defaultThresholds],
  });

  const wsRef = useRef();
  const wsCallbacksRef = useRef({});

  const emit = useCallback((msg) => {
    // Throw error if the websocket connection is not ready yet.
    // App should wait for isWsReady to send messages.
    if (!wsRef.current || !isWsReady) {
      throw new Error("emit() called before isWsReady === true.");
    } else if (wsRef.current.readyState !== 1 /* OPEN */) {
      // The states are CONNECTING (0), OPEN (1), CLOSING (2) and CLOSED (3).
      // If the effect that opened the socket is cleaning up, some message
      // could still be sent, but should be ignored here.
      return;
    }

    wsRef.current.send(JSON.stringify(msg));
  }, [isWsReady, wsRef]);

  wsCallbacksRef.current.values = function(msg) {
    const curValues = curValuesRef.current;
    if (curValues.kCurValues.length < max_size) {
      curValues.kCurValues.push(msg.values);
    } else {
      curValues.kCurValues[curValues.oldest] = msg.values;
      curValues.oldest = (curValues.oldest + 1) % max_size;
    }
    if (curValues.kCurValues.length === 1) {
      // WebSocket is considered ready after it gets its first "values" message.
      setIsWsReady(true);
    }
  };

  wsCallbacksRef.current.thresholds = function(msg) {
    // Modify thresholds array in place instead of replacing it so that animation loops can have a stable reference.
    curValuesRef.current.kCurThresholds.length = 0;
    curValuesRef.current.kCurThresholds.push(...msg.thresholds);
  };

  useEffect(() => {
    let cleaningUp = false;

    const ws = new WebSocket('ws://' + window.location.host + '/ws');
    wsRef.current = ws;

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
  }, [onCloseWs, setIsWsReady]);

  return { curValuesRef, emit, isWsReady, wsCallbacksRef };
}


// An interactive display of the current values obtained by the backend.
// Also has functionality to manipulate thresholds.
function ValueMonitor(props) {
  const index = parseInt(props.index)
  const emit = props.emit;
  const thresholdLabelRef = React.useRef(null);
  const valueLabelRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const curValuesRef = useContext(CurValuesRefContext);
  const kCurValues = curValuesRef.current.kCurValues;
  const kCurThresholds = curValuesRef.current.kCurThresholds;

  function EmitValue(val) {
    // Send back all the thresholds instead of a single value per sensor. This is in case
    // the server restarts where it would be nicer to have all the values in sync.
    // Still send back the index since we want to update only one value at a time
    // to the microcontroller.
    emit(['update_threshold', kCurThresholds, index]);
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
      const oldest = curValuesRef.current.oldest;

      if (previousTimestamp && (timestamp - previousTimestamp) < minFrameDurationMs) {
        requestId = requestAnimationFrame(render);
        return;
      }
      previousTimestamp = timestamp;

      // Get the latest value. This is either last element in the list, or based off of
      // the circular array.
      let currentValue = 0;
      if (kCurValues.length < max_size) {
        currentValue = kCurValues[kCurValues.length-1][index];
      } else {
        currentValue = kCurValues[((oldest - 1) % max_size + max_size) % max_size][index];
      }

      // Add background fill.
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
      const threshold_pos = (1023-kCurThresholds[index])/1023 * canvas.height;
      ctx.fillStyle = "black";
      ctx.fillRect(0, threshold_pos-Math.floor(threshold_height/2), canvas.width, threshold_height);

      // Threshold Label
      thresholdLabel.innerText = kCurThresholds[index];
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
      window.removeEventListener('resize', setDimensions);
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

function ValueMonitors(props) {
  const { emit, numPanels} = props;
  return (
    <header className="App-header">
      <Container fluid style={{border: '1px solid white', height: '100vh'}}>
        <Row>
          {[...Array(numPanels).keys()].map(index => (
          	<ValueMonitor emit={emit} index={index} key={index} />)
          )}
        </Row>
      </Container>
    </header>
  );
}

function Plot() {
  const canvasRef = React.useRef(null);
  const colors = ['red', 'orange', 'green', 'blue'];
  const display = [true, true, true, true];
  const curValuesRef = useContext(CurValuesRefContext);
  const kCurValues = curValuesRef.current.kCurValues;
  const kCurThresholds = curValuesRef.current.kCurThresholds;

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
      const oldest = curValuesRef.current.oldest;

      if (previousTimestamp && (timestamp - previousTimestamp) < minFrameDurationMs) {
        requestId = requestAnimationFrame(render);
        return;
      }
      previousTimestamp = timestamp;

      // Add background fill.
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

      // Draw the divisions in the plot.
      // Major Divisions will be 2 x minor_divison.
      const minor_division = 100;
      for (let i = 1; i*minor_division < 1023; ++i) {
        const pattern = i % 2 === 0 ? [20, 5] : [5, 10];
        drawDashedLine(pattern, spacing,
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
      window.removeEventListener('resize', setDimensions);
    };
  }, [colors, curValuesRef, display, kCurThresholds, kCurValues]);

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

function FSRWebUI(props) {
  const { curValuesRef, emit, defaults, wsCallbacksRef } = props;
  const numPanels = defaults.thresholds.length;
  const [profiles, setProfiles] = useState(defaults.profiles);
  const [activeProfile, setActiveProfile] = useState(defaults.cur_profile);
  useEffect(() => {
    const wsCallbacks = wsCallbacksRef.current;

    wsCallbacks.get_profiles = function(msg) {
      setProfiles(msg.profiles);
    };
    wsCallbacks.get_cur_profile = function(msg) {
      setActiveProfile(msg.cur_profile);
    };

    return () => {
      delete wsCallbacks.get_profiles;
      delete wsCallbacks.get_cur_profile;
    };
  }, [profiles, wsCallbacksRef]);

  function AddProfile(e) {
    // Only add a profile on the enter key.
    if (e.keyCode === 13) {
      emit(['add_profile', e.target.value, curValuesRef.current.kCurThresholds]);
      // Reset the text box.
      e.target.value = "";
    }
    return false;
  }

  function RemoveProfile(e) {
    // Strip out the "X " added by the button.
    const profile_name = e.target.parentNode.innerText.replace('X ', '');
    emit(['remove_profile', profile_name]);
  }

  function ChangeProfile(e) {
    // Strip out the "X " added by the button.
    const profile_name = e.target.innerText.replace('X ', '');
    emit(['change_profile', profile_name]);
  }

  return (
    <CurValuesRefContext.Provider value={curValuesRef}>
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
              <ValueMonitors emit={emit} numPanels={numPanels} />
            </Route>
            <Route path="/plot">
              <Plot />
            </Route>
          </Switch>
        </Router>
      </div>
    </CurValuesRefContext.Provider>
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

function WsConnectionWrapper(props) {
  const { defaults, reloadDefaults } = props;
  const {
    curValuesRef,
    emit,
    isWsReady,
    wsCallbacksRef
  } = useWsConnection({ defaultThresholds: defaults.thresholds, onCloseWs: reloadDefaults });

  if (isWsReady) {
    return (
      <FSRWebUI
        curValuesRef={curValuesRef}
        defaults={defaults}
        emit={emit}
        wsCallbacksRef={wsCallbacksRef}
      />
    );
  } else {
    return <LoadingScreen />
  }
}

// Returned `defaults` property will be undefined if the defaults are loading or reloading.
// Call `reloadDefaults` to clear the defaults and reload from the server.
function useDefaults() {
  const [defaults, setDefaults] = useState();

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

function App() {
  const { defaults, reloadDefaults } = useDefaults();

  // Don't render anything until the defaults are fetched.
  if (defaults) {
    return <WsConnectionWrapper defaults={defaults} reloadDefaults={reloadDefaults} />
  } else {
    return <LoadingScreen />
  }
}

export default App;
