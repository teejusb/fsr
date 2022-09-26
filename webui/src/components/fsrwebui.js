import React, { useEffect, useState } from 'react';

import Navbar from 'react-bootstrap/Navbar'
import Nav from 'react-bootstrap/Nav'
import Dropdown from './dropdown'

import Form from 'react-bootstrap/Form'
import Button from 'react-bootstrap/Button'

import {
  BrowserRouter as Router,
  Switch,
  Route,
  Link
} from "react-router-dom";

import ValueMonitors from './ui/valuemonitors'
import ValueMonitor from './ui/valuemonitor'
import Plot from './ui/plot'

const FSRWebUI = (props) => {
  const { emit, defaults, webUIDataRef, wsCallbacksRef, maxSize } = props;
  const numSensors = defaults.thresholds.length;
  const [ profiles, setProfiles ] = useState(defaults.profiles);
  const [ activeProfile, setActiveProfile ] = useState(defaults.cur_profile);
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

  return (
    <div className="App">
      <Router>
        <Navbar bg="light">
          <Navbar.Brand as={Link} to="/">FSR UI</Navbar.Brand>
          <Nav>
            <Nav.Item>
              <Nav.Link as={Link} to="/plot">Plot</Nav.Link>
            </Nav.Item>
          </Nav>
          <Nav className="ml-auto">
            <Dropdown emit={emit} profiles={profiles} activeProfile={activeProfile} />
          </Nav>
        </Navbar>
        <Switch>
          <Route exact path="/">
            <ValueMonitors numSensors={numSensors}>
              {[...Array(numSensors).keys()].map(index => (
                <ValueMonitor emit={emit} index={index} key={index} webUIDataRef={webUIDataRef} maxSize={maxSize} />)
              )}
            </ValueMonitors>
          </Route>
          <Route path="/plot">
            <Plot numSensors={numSensors} webUIDataRef={webUIDataRef} maxSize={maxSize} />
          </Route>
        </Switch>
      </Router>
    </div>
  );
}

export default FSRWebUI;