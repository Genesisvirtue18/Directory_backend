export const sendSuccess = (res, message, data = {}, status = 200) =>
  res.status(status).json({ success: true, message, data });

export const sendError = (res, status, message, errors = []) =>
  res.status(status).json({ success: false, message, errors });
