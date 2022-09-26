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

  if (defaults && isWsReady) {
    return (
      <FSRWebUI
        maxSize={MAX_SIZE}
        defaults={defaults}
        emit={emit}
        webUIDataRef={webUIDataRef}
        wsCallbacksRef={wsCallbacksRef}
      />
    );
  } else {
    return <LoadingScreen />;
  }
}

export default App;
