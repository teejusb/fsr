import React, { useEffect, useState } from 'react';

import Navbar from 'react-bootstrap/Navbar'
import Nav from 'react-bootstrap/Nav'
import NavDropdown from 'react-bootstrap/NavDropdown'

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

  function ChangeProfile(e) {
    // Strip out the "X " added by the button.
    const profile_name = e.target.innerText.replace('X ', '');
    emit(['change_profile', profile_name]);
  }

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