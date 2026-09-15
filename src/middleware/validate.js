import { AppError } from '../utils/AppError.js';

export const validate = schema => async (req, res, next) => {
  const result = await schema.safeParseAsync({ body: req.body, params: req.params, query: req.query });
  if (!result.success) {
    return next(new AppError('Request validation failed', 400, result.error.issues.map(issue => ({
      field: issue.path.join('.'), message: issue.message,
    }))));
  }
  // Express 5 query is a getter. Consume parsed/coerced values from req.validated.
  req.validated = result.data;
  next();
};
