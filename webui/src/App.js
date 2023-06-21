import React from "react";

import useDefaults from "./helpers/usedefaults";
import useWsConnection from "./helpers/usewsconnection";

import FSRWebUI from "./components/fsrwebui";
import LoadingScreen from "./components/loadingscreen";

// Maximum number of historical sensor values to retain
const MAX_SIZE = 1000;

function App() {
  const { defaults, reloadDefaults } = useDefaults();
  const { emit, isWsReady, webUIDataRef, wsCallbacksRef } = useWsConnection({
    defaults,
    onCloseWs: reloadDefaults,
    MAX_SIZE,
  });

  let deviceType;
  if (navigator.userAgent.match(/Android/i)
    || navigator.userAgent.match(/webOS/i)
    || navigator.userAgent.match(/iPhone/i)
    || navigator.userAgent.match(/iPad/i)
    || navigator.userAgent.match(/iPod/i)
    || navigator.userAgent.match(/BlackBerry/i)
    || navigator.userAgent.match(/Windows Phone/i)) {
    deviceType = "Mobile";
  } else {
    deviceType = "Desktop";
  }

  if (defaults && isWsReady) {
    return (
      <FSRWebUI
        deviceType={deviceType}
        defaults={defaults}
        emit={emit}
        maxSize={MAX_SIZE}
        webUIDataRef={webUIDataRef}
        wsCallbacksRef={wsCallbacksRef}
      />
    );
  } else {
    return <LoadingScreen />;
  }
}

export default App;
