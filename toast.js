(function() {
  function updateToastPositions() {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toasts = Array.from(container.querySelectorAll(".toast"));
    toasts.forEach((toast, index) => {
      toast.style.setProperty("--index", index);
    });
  }

  function removeToast(toast, container) {
    toast.remove();
    updateToastPositions();
    if (container.children.length === 0) {
      container.remove();
    }
  }

  window.showToast = function(message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "toast-container";
      document.body.appendChild(container);
    }

    const toastId = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const toast = document.createElement("div");
    toast.id = toastId;
    toast.setAttribute("popover", "manual");
    toast.className = `toast toast-${type}`;
    
    let icon = "💡";
    if (type === "success") icon = "✅";
    else if (type === "error") icon = "❌";
    else if (type === "warning") icon = "⚠️";

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close" popovertarget="${toastId}" popovertargetaction="hide" aria-label="Close notification">×</button>
    `;

    container.appendChild(toast);
    updateToastPositions();

    // Listen to toggle event for exit animations and cleanup
    toast.addEventListener("toggle", (event) => {
      if (event.newState === "closed") {
        const animations = toast.getAnimations();
        if (animations.length > 0) {
          Promise.all(animations.map(anim => anim.finished))
            .then(() => removeToast(toast, container))
            .catch(() => removeToast(toast, container));
        } else {
          removeToast(toast, container);
        }
      }
    });

    toast.showPopover();

    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      if (toast.matches(":popover-open")) {
        toast.hidePopover();
      }
    }, 3000);
  };
})();
