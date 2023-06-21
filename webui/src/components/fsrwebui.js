import React, { useEffect, useState } from "react";

import { BrowserRouter as Router, Switch, Route } from "react-router-dom";

import NavbarComponent from "./navbarcomponent";
import Monitor from "./ui_components/monitor";
import Plot from "./ui_components/plot";

const FSRWebUI = (props) => {
  const {
    emit,
    defaults,
    webUIDataRef,
    wsCallbacksRef,
    maxSize,
    deviceType
  } = props;
  const numSensors = defaults.thresholds.length;
  const [profiles, setProfiles] = useState(defaults.profiles);
  const [activeProfile, setActiveProfile] = useState(defaults.cur_profile);

  useEffect(() => {
    const wsCallbacks = wsCallbacksRef.current;

    wsCallbacks.get_profiles = function (msg) {
      setProfiles(msg.profiles);
    };
    wsCallbacks.get_cur_profile = function (msg) {
      setActiveProfile(msg.cur_profile);
    };

    return () => {
      delete wsCallbacks.get_profiles;
      delete wsCallbacks.get_cur_profile;
    };
  }, [profiles, wsCallbacksRef]);

  debugger
  return (
    <div className={`App ${deviceType}`}>
      <Router>
        <NavbarComponent
          emit={emit}
          profiles={profiles}
          activeProfile={activeProfile}
          webUIDataRef={webUIDataRef}
        />
        <Switch>
          <Route exact path="/">
            <Monitor
              numSensors={numSensors}
              emit={emit}
              webUIDataRef={webUIDataRef}
              maxSize={maxSize}
            />
          </Route>
          <Route path="/plot">
            <Plot
              numSensors={numSensors}
              webUIDataRef={webUIDataRef}
              maxSize={maxSize}
            />
          </Route>
        </Switch>
      </Router>
    </div>
  );
};

export default FSRWebUI;
