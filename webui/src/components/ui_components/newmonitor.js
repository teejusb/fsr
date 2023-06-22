import React, { useCallback, useEffect } from "react";

// An interactive display of the current values obtained by the backend.
// Also has functionality to manipulate thresholds.
const NewMonitor = (props) => {
  const { emit, index, webUIDataRef, maxSize, even, dir, deviceType } = props;
  const thresholdLabelRef = React.useRef(null);
  const valueLabelRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const curValues = webUIDataRef.current.curValues;
  const curThresholds = webUIDataRef.current.curThresholds;

  const EmitValue = useCallback(
    (val) => {
      // Send back all the thresholds instead of a single value per sensor. This is in case
      // the server restarts where it would be nicer to have all the values in sync.
      // Still send back the index since we want to update only one value at a time
      // to the microcontroller.
      emit(["update_threshold", curThresholds, index]);
    },
    [curThresholds, emit, index]
  );

  const changeValue = (num) => {
    const val = curThresholds[index] + num;
    if (val >= 0 && val <= 1023) {
      curThresholds[index] = val;
      EmitValue(val);
      thresholdLabelRef.current.value = val;
      thresholdLabelRef.current.style.backgroundColor = "#ffffff";
    }
  };

  const updateThreshold = (e) => {
    thresholdLabelRef.current.style.backgroundColor = "#d1fccf";
    const val = parseInt(e.target.value);
    if (e.keyCode === 13 && val >= 0 && val <= 1023) {
      curThresholds[index] = val;
      EmitValue(val);
      e.target.value = val;
      thresholdLabelRef.current.style.backgroundColor = "#ffffff";
    }

    if (e.keyCode === 13 && (val < 0 || val > 1023)) {
      if (val < 0) {
        curThresholds[index] = 0;
        EmitValue(0);
        e.target.value = 0;
      }
      
      if (val > 1023) {
        curThresholds[index] = 1023;
        EmitValue(1023);
        e.target.value = 1023;
      }

      thresholdLabelRef.current.style.backgroundColor = '#ffffff'
    }
  };

  useEffect(() => {
    let requestId;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    if (deviceType === "Desktop") {
      function getMousePos(canvas, e) {
        const rect = canvas.getBoundingClientRect();
        const dpi = window.devicePixelRatio || 1;
        return {
          x: (e.clientX - rect.left) * dpi,
          y: (e.clientY - rect.top) * dpi,
        };
      }
  
      function getTouchPos(canvas, e) {
        const rect = canvas.getBoundingClientRect();
        const dpi = window.devicePixelRatio || 1;
        return {
          x: (e.targetTouches[0].pageX - rect.left - window.pageXOffset) * dpi,
          y: (e.targetTouches[0].pageY - rect.top - window.pageYOffset) * dpi,
        };
      }
      // Change the thresholds while dragging, but only emit on release.
      let is_drag = false;
  
      // Mouse Events
      canvas.addEventListener("mousedown", function (e) {
        let pos = getMousePos(canvas, e);
        curThresholds[index] = Math.floor(1023 - (pos.y / canvas.height) * 1023);
        is_drag = true;
      });
  
      canvas.addEventListener("mouseup", function (e) {
        EmitValue(curThresholds[index]);
        thresholdLabelRef.current.value = curThresholds[index];
        thresholdLabelRef.current.style.backgroundColor = "#ffffff";
        is_drag = false;
      });
  
      canvas.addEventListener("mousemove", function (e) {
        if (is_drag) {
          let pos = getMousePos(canvas, e);
          curThresholds[index] = Math.floor(
            1023 - (pos.y / canvas.height) * 1023
          );
        }
      });
  
      // Touch Events
      canvas.addEventListener("touchstart", function (e) {
        let pos = getTouchPos(canvas, e);
        curThresholds[index] = Math.floor(1023 - (pos.y / canvas.height) * 1023);
        is_drag = true;
      });
  
      canvas.addEventListener("touchend", function (e) {
        // We don't need to get the
        EmitValue(curThresholds[index]);
        thresholdLabelRef.current.value = curThresholds[index];
        thresholdLabelRef.current.style.backgroundColor = "#ffffff";
        is_drag = false;
      });
  
      canvas.addEventListener("touchmove", function (e) {
        if (is_drag) {
          let pos = getTouchPos(canvas, e);
          curThresholds[index] = Math.floor(
            1023 - (pos.y / canvas.height) * 1023
          );
        }
      });
    }

    const setDimensions = () => {
      // Adjust DPI so that all the edges are smooth during scaling.
      const dpi = window.devicePixelRatio || 1;

      canvas.width = canvas.clientWidth * dpi;
      canvas.height = canvas.clientHeight * dpi;
    };

    setDimensions();
    window.addEventListener("resize", setDimensions);

    // This is default React CSS font style.
    const bodyFontFamily = window
      .getComputedStyle(document.body)
      .getPropertyValue("font-family");
    const valueLabel = valueLabelRef.current;

    // cap animation to 60 FPS (with slight leeway because monitor refresh rates are not exact)
    const minFrameDurationMs = 1000 / 60.1;
    var previousTimestamp;

    const render = (timestamp) => {
      const oldest = webUIDataRef.current.oldest;

      if (
        previousTimestamp &&
        timestamp - previousTimestamp < minFrameDurationMs
      ) {
        requestId = requestAnimationFrame(render);
        return;
      }
      previousTimestamp = timestamp;

      // Get the latest value. This is either last element in the list, or based off of
      // the circular array.
      let currentValue = 0;
      if (curValues.length < maxSize) {
        currentValue = curValues[curValues.length - 1][index];
      } else {
        currentValue =
          curValues[(((oldest - 1) % maxSize) + maxSize) % maxSize][index];
      }

      // Add background fill.
      let grd = ctx.createLinearGradient(
        canvas.width / 2,
        0,
        canvas.width / 2,
        canvas.height
      );
      if (currentValue >= curThresholds[index]) {
        grd.addColorStop(0, "lightblue");
        grd.addColorStop(1, "blue");
      } else {
        grd.addColorStop(0, "lightblue");
        grd.addColorStop(1, "gray");
      }
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Cur Value Label
      valueLabel.innerText = currentValue;

      // Bar
      const maxHeight = canvas.height;
      const position = Math.round(
        maxHeight - (currentValue / 1023) * maxHeight
      );
      grd = ctx.createLinearGradient(
        canvas.width / 2,
        canvas.height,
        canvas.width / 2,
        position
      );
      grd.addColorStop(0, "orange");
      grd.addColorStop(1, "red");
      ctx.fillStyle = grd;
      ctx.fillRect(canvas.width / 4, position, canvas.width / 2, canvas.height);

      // Threshold Line
      const threshold_height = 3;
      const threshold_pos =
        ((1023 - curThresholds[index]) / 1023) * canvas.height;
      ctx.fillStyle = "black";
      ctx.fillRect(
        0,
        threshold_pos - Math.floor(threshold_height / 2),
        canvas.width,
        threshold_height
      );

      // Threshold Label
      ctx.font = "2rem " + bodyFontFamily;
      ctx.fillStyle = "black";
      if (curThresholds[index] > 990) {
        ctx.textBaseline = "top";
      } else {
        ctx.textBaseline = "bottom";
      }
      ctx.fillText(
        curThresholds[index].toString(),
        0,
        threshold_pos + threshold_height + 1
      );

      requestId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(requestId);
      window.removeEventListener("resize", setDimensions);
    };
  }, [EmitValue, curThresholds, curValues, index, webUIDataRef, maxSize]);

  return (
    <div className="monitor">
      <div className={`monitor-buttons ${even ? "even" : ""}`}>
        <button className="dec" onClick={() => changeValue(-1)}>
          -1
        </button>
        <button className="inc" onClick={() => changeValue(1)}>
          +1
        </button>
        <button className="dec" onClick={() => changeValue(-5)}>
          -5
        </button>
        <button className="inc" onClick={() => changeValue(5)}>
          +5
        </button>
        <button className="dec" onClick={() => changeValue(-10)}>
          -10
        </button>
        <button className="inc" onClick={() => changeValue(10)}>
          +10
        </button>
      </div>
      <div className="threshold-wrapper">
        <span>{dir}:</span>
        <input
          type="text"
          className="monitor-label"
          defaultValue={curThresholds[index]}
          onKeyDown={(e) => updateThreshold(e)}
          ref={thresholdLabelRef}
        />
      </div>
      <div className="num-wrapper">
        <label className="monitor-label" ref={valueLabelRef}>
          0
        </label>
      </div>
      <canvas className="monitor-canvas" ref={canvasRef} />
    </div>
  );
};

export default NewMonitor;
