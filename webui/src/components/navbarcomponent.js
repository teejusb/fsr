import React, { useState } from "react";

import Dropdown from "./dropdown";
import DeleteModal from "./deletemodal";

import { Link } from "react-router-dom";

const NavbarComponent = (props) => {
  const { emit, profiles, activeProfile, webUIDataRef } = props;
  const [state, setState] = useState({
    openModal: false,
    profileToDelete: null
  })

  const toggleModal = (profileName) => {
    setState(prevState => ({
      modalOpen: !prevState.modalOpen,
      profileToDelete: profileName
    }))
  }

  const removeProfile = (profileName, e) => {
    e.stopPropagation();
    emit(["remove_profile", profileName]);
    setState({
      modalOpen: false,
      profileToDelete: null
    })
  }

  return (
    <>
      <nav className="main-nav">
        <span className="nav-left">
          <Link to="/">
            FSR UI
          </Link>
          <Link to="/plot">
            Data Plot
          </Link>
        </span>
          <Dropdown
            toggleModal={toggleModal}
            emit={emit}
            profiles={profiles}
            activeProfile={activeProfile}
            webUIDataRef={webUIDataRef}
          />
      </nav>
      {state.modalOpen &&
        <DeleteModal
          toggleModal={toggleModal}
          removeProfile={removeProfile}
          profile={state.profileToDelete} 
        />
      }
    </>
  );
};

export default NavbarComponent;
