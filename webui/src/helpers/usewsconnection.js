import { useCallback, useEffect, useState, useRef } from 'react'

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
const useWsConnection = ({ defaults, onCloseWs, MAX_SIZE }) => {
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

export default useWsConnection;