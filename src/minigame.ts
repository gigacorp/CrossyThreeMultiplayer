import { Scene, Object3D } from "three";
import { Workspace } from "./client-types";

export interface Minigame {
    /** Instructions displayed to the player at the start */
    instructions: string;

    /** Called once to load any assets or setup needed before the game starts */
    load: (scene: Scene) => void;

    /** Called when the minigame officially begins */
    start: (workspace: Workspace) => void;

    /** Called every frame to update the minigame state */
    update: (delta: number, workspace: Workspace) => void;

    /** Called when the minigame ends */
    end: () => void;

    /** Called when a player (local or remote) spawns into the game world */
    onPlayerDidSpawn: (player: Object3D) => void;

    /** Called when a player (local or remote) finishes a move */
    onPlayerDidMove: (player: Object3D) => void;

    /** Called when two players collide or touch */
    onPlayersDidTouch: (player1: Object3D, player2: Object3D) => void;
}
