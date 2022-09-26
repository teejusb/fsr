import React, { useEffect, useState } from "react";

import { BrowserRouter as Router, Switch, Route } from "react-router-dom";

import NavbarComponent from "./navbarcomponent";
import ValueMonitors from "./ui_components/valuemonitors";
import ValueMonitor from "./ui_components/valuemonitor";
import FastMonitor from "./ui_components/fastmonitor";
import Plot from "./ui_components/plot";

const FSRWebUI = (props) => {
  const { emit, defaults, webUIDataRef, wsCallbacksRef, maxSize } = props;
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

  return (
    <div className="App">
      <Router>
        <NavbarComponent
          emit={emit}
          profiles={profiles}
          activeProfile={activeProfile}
          webUIDataRef={webUIDataRef}
        />
        <Switch>
          <Route exact path="/">
            <ValueMonitors numSensors={numSensors}>
              {[...Array(numSensors).keys()].map((index) => (
                <ValueMonitor
                  emit={emit}
                  index={index}
                  key={index}
                  webUIDataRef={webUIDataRef}
                  maxSize={maxSize}
                />
              ))}
            </ValueMonitors>
          </Route>
          <Route path="/plot">
            <Plot
              numSensors={numSensors}
              webUIDataRef={webUIDataRef}
              maxSize={maxSize}
            />
          </Route>
          <Route path="/fast">
            <ValueMonitors numSensors={numSensors} className={"FastMonitor"}>
              {[...Array(numSensors).keys()].map((index) => (
                <FastMonitor
                  emit={emit}
                  index={index}
                  key={index}
                  webUIDataRef={webUIDataRef}
                  maxSize={maxSize}
                />
              ))}
            </ValueMonitors>
          </Route>
        </Switch>
      </Router>
    </div>
  );
};

export default FSRWebUI;
