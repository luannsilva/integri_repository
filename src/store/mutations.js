export default {
  SET_USER (state, payload) {
    state.user = payload
  },
  SET_TRENDS (state, payload) {
    state.trends = payload
  },
  TOGGLE_CHAT_VISIBILITY (state, payload) {
    state.displayChat.active = !state.displayChat.active
  },
  SHOW_CHAT_NOTIFICATION (state, payload) {
    state.displayChat.isNotificationActive = true
  },
  HIDE_CHAT_NOTIFICATION (state, payload) {
    state.displayChat.isNotificationActive = false
  },
  HIDE_CHAT_LABEL (state, payload) {
    state.displatLabel.isNotificationActive = false
  },
  ADD_TEXT (state, payload) {
    state.chat.push(payload)
  },
  SET_CONTEXT (state, payload) {
    state.context = payload
  }
}
