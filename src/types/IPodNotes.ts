import { IAPI } from 'src/API/IAPI';
import { IPodNotesSettings } from './IPodNotesSettings';


export interface IPodNotes {
	settings: IPodNotesSettings;
	api: IAPI;
	saveSettings(): Promise<void>;
}
