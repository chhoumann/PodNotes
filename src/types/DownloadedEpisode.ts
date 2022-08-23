import { Episode } from "./Episode";

export default interface DownloadedEpisode extends Episode {
	filePath: string;
}
