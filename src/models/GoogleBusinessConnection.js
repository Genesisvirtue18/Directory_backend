import mongoose from 'mongoose';
const { Schema } = mongoose;
const connectionSchema = new Schema({ business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, unique: true }, owner: { type: Schema.Types.ObjectId, ref: 'User', required: true }, refreshToken: { type: String, required: true } }, { timestamps: true });
export const GoogleBusinessConnection = mongoose.model('GoogleBusinessConnection', connectionSchema);
const stateSchema = new Schema({ hash: { type: String, required: true, unique: true }, business: { type: Schema.Types.ObjectId, ref: 'Business', required: true }, owner: { type: Schema.Types.ObjectId, ref: 'User', required: true }, expiresAt: { type: Date, required: true, expires: 0 } }, { timestamps: true });
export const GoogleBusinessOAuthState = mongoose.model('GoogleBusinessOAuthState', stateSchema);
const selectionSchema = new Schema({ business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, unique: true }, owner: { type: Schema.Types.ObjectId, ref: 'User', required: true }, accountName: { type: String, required: true }, locationName: { type: String, required: true }, title: { type: String, required: true }, mapsUri: String, expiresAt: { type: Date, required: true, expires: 0 } }, { timestamps: true });
export const GoogleBusinessSelection = mongoose.model('GoogleBusinessSelection', selectionSchema);
