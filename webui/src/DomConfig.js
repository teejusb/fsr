import React from "react";

function DomConfig(props) {
  function handleChange(event) {
    let color = event.target.value;
    console.log("update_color_profile", color);
    props.emit(["update_color_profile", color]);
    props.setActiveColorProfile(color);
  }

  return (
    <div>
      <h1>Dom's Special Config</h1>
      <h2>Color Profile</h2>
      <form>
        <label>
          Pad color profile:
          <br />
          <select value={props.activeColorProfile} onChange={handleChange}>
            <option value="0">Test</option>
            <option value="1">ITG</option>
            <option value="2">DDR</option>
            <option value="3">Brazil</option>
            <option value="4">Frozen</option>
            <option value="5">Italy</option>
            <option value="6">One at a time test</option>
            <option value="7">Princess</option>
            <option value="8">Navi</option>
            <option value="9">USA</option>
            <option value="10">Yellow → Black</option>
            <option value="11">Red → Black</option>
            <option value="12">Blue → Black</option>
            <option value="13">Green → Black</option>
            <option value="14">White → Black</option>
            <option value="15">Black → White</option>
            <option value="16">Black → Red</option>
            <option value="17">Black → Blue</option>
            <option value="18">Black → Green</option>
            <option value="19">Black → DDR</option>
            <option value="20">Black → ITG</option>
            <option value="21">Red → Blue</option>
            <option value="22">Blue → Red</option>
            <option value="23">Red → Green</option>
            <option value="24">Green → Red</option>
            <option value="25">Yellow → Red</option>
            <option value="26">Blue → Yellow</option>
            <option value="27">Yellow → Blue</option>
            <option value="28">Blue → Green</option>
            <option value="29">Green → Blue</option>
            <option value="30">Yellow → Green</option>
            <option value="31">Green → Yellow</option>
            <option value="32">Blue → Pink</option>
            <option value="33">Pink → Blue</option>
            <option value="34">Yellow → Pink</option>
            <option value="35">Pink → Yellow</option>
            <option value="36">White → Red</option>
            <option value="37">White → Blue</option>
            <option value="38">White → Green</option>
            <option value="39">White → Yellow</option>
            <option value="40">White → Pink</option>
            <option value="41">Red → White</option>
            <option value="42">Blue → White</option>
            <option value="43">Green → White</option>
            <option value="44">Yellow → White</option>
            <option value="45">Pink → White</option>
          </select>
        </label>
      </form>
    </div>
  );
}

export default DomConfig;
