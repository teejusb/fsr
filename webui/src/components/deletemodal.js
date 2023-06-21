import React from "react";
import Button from "react-bootstrap/Button";

const DeleteModal = (props) => {
  const { toggleModal, removeProfile, profile } = props;
  return (
    <div className="delete-modal">
      <div className="modal-block" onClick={() => toggleModal(null)} />
      <div className="modal-body">
        <h4>Do you want to delete {profile}?</h4>
        <span>
          <Button variant="light" onClick={(e) => removeProfile(profile, e)}>
            YES
          </Button>
          <Button variant="light" onClick={() => toggleModal(null)}>
            NO
          </Button>
        </span>
      </div>
    </div>
  )
}

export default DeleteModal