import type { IAPI } from 'src/API/IAPI';
import type { IPodNotesSettings } from './IPodNotesSettings';


export interface IPodNotes {
	settings: IPodNotesSettings;
	api: IAPI;
	saveSettings(): Promise<void>;
}
