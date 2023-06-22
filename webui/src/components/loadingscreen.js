import React from "react";

const LoadingScreen = () => {
  return (
    <div className="loading-main">
      <nav>
        <span>
          FSR WebUI
        </span>
      </nav>
      <p>Not connected! Please check the connection with your controller.</p>
    </div>
  );
};

export default LoadingScreen;
