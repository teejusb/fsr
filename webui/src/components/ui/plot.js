import React, { useEffect, useState } from 'react'

import Row from 'react-bootstrap/Row'
import Col from 'react-bootstrap/Col'
import Container from 'react-bootstrap/Container'
import ToggleButton from 'react-bootstrap/ToggleButton'

const Plot = (props) => {
  const { numSensors, webUIDataRef, maxSize } = props;
  const canvasRef = React.useRef(null);
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
      const box_width = canvas.width - spacing * 2;
      const box_height = canvas.height - spacing * 2
      ctx.strokeStyle = 'darkgray';
      ctx.beginPath();
      ctx.rect(spacing, spacing, box_width, box_height);
      ctx.stroke();

      // Draw the divisions in the plot.
      // Major Divisions will be 2 x minor_divison.
      const minor_division = 100;
      for (let i = 1; i * minor_division < 1023; ++i) {
        const pattern = i % 2 === 0 ? [20, 5] : [5, 10];
        drawDashedLine(pattern, spacing,
          box_height - (box_height * (i * minor_division) / 1023) + spacing, box_width + spacing);
      }

      // Plot the line graph for each of the sensors.
      const px_per_div = box_width / maxSize;
      for (let i = 0; i < numSensors; ++i) {
        if (display[i]) {
          ctx.beginPath();
          ctx.setLineDash([]);
          ctx.strokeStyle = colors[i];
          ctx.lineWidth = 2;
          for (let j = 0; j < maxSize; ++j) {
            if (j === curValues.length) { break; }
            if (j === 0) {
              ctx.moveTo(spacing,
                box_height - box_height * curValues[(j + oldest) % maxSize][i] / 1023 + spacing);
            } else {
              ctx.lineTo(px_per_div * j + spacing,
                box_height - box_height * curValues[(j + oldest) % maxSize][i] / 1023 + spacing);
            }
          }
          ctx.stroke();
        }
      }

      // Display the current thresholds.
      for (let i = 0; i < numSensors; ++i) {
        if (display[i]) {
          ctx.beginPath();
          ctx.setLineDash([]);
          ctx.strokeStyle = darkColors[i];
          ctx.lineWidth = 2;
          ctx.moveTo(spacing, box_height - box_height * curThresholds[i] / 1023 + spacing);
          ctx.lineTo(box_width + spacing, box_height - box_height * curThresholds[i] / 1023 + spacing);
          ctx.stroke();
        }
      }

      // Display the current value for each of the sensors.
      ctx.font = "30px " + bodyFontFamily;
      for (let i = 0; i < numSensors; ++i) {
        if (display[i]) {
          ctx.fillStyle = colors[i];
          if (curValues.length < maxSize) {
            ctx.fillText(curValues[curValues.length - 1][i], 100 + i * 100, 100);
          } else {
            ctx.fillText(
              curValues[((oldest - 1) % maxSize + maxSize) % maxSize][i], 100 + i * 100, 100);
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
  }, [colors, curThresholds, curValues, darkColors, display, numSensors, webUIDataRef, maxSize]);

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
        <b style={{ color: display[i] ? darkColors[i] : "#f8f9fa" }}>
          {numSensors === buttonNames.length ? buttonNames[i] : i}
        </b>
      </ToggleButton>
    );
  }

  return (
    <header className="App-header">
      <Container fluid style={{ border: '1px solid white', height: '100vh' }}>
        <Row>
          <Col style={{ height: '9vh', paddingTop: '2vh' }}>
            <span>Display: </span>
            {toggleButtons}
          </Col>
        </Row>
        <Row>
          <Col style={{ height: '86vh' }}>
            <canvas
              ref={canvasRef}
              style={{ border: '1px solid white', width: '100%', height: '100%', touchAction: "none" }} />
          </Col>
        </Row>
      </Container>
    </header>
  );
}

export default Plot;