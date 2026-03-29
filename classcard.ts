import axios, { Axios, AxiosResponse } from 'axios';
import Websocket from "ws";
import EventEmitter from "events";
import { URLSearchParams } from "url";

enum setType {
    "word" = 1,     // 단어
    "term",          // 용어
    "quest" = 4,     // 문제
    "sentence",      // 문장
    "drill",         // 드릴
    "listen",        // 듣기
    "answer"         // 정답
};
enum learningType {
    "암기학습" = "Memorize",
    "리콜학습" = "Recall",
    "스펠학습" = "Spell"
};
enum Activity {
    "암기학습" = 1,
    "리콜학습",
    "스펠학습",
    "Memorize" = 1,
    "Recall",
    "Spell",
    "매칭" = 4,
    "스크램블" = 4,
    "크래시",
};

function transformRequest(jsonData: Object = {}): string {
    return Object.entries(jsonData).map(x => `${encodeURIComponent(x[0])}=${encodeURIComponent(x[1])}`).join('&');
};

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
};

export { ClassCard, learningType, Activity, setType };

export default class ClassCard {
    private client: Axios;
    public set: {
        id: number,
        name: string,
        type: number,
        study_data: { "card_idx": number }[]
    };
    public class: {
        id: number,
        name: string
    };
    public user: {
        name: string,
        id: number,
        token: string,
        isPro: boolean,
        isTeacher: boolean
    };
    public folders: {
        "id": number,
        "name": string,
        path: string,
        "default": boolean
    }[];
    public classes: {
        id: number,
        name: string
    }[];

    constructor() {
        this.client = axios.create({
            headers: {
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Referer": "https://www.classcard.net/",
            },
            withCredentials: true,
        });
        this.set = { id: 0, name: "", type: 0, study_data: [] };
        this.class = { id: 0, name: "" };
        this.user = { name: "", id: 0, token: "", isPro: false, isTeacher: false };
        this.folders = [];
        this.classes = [];
    };

    async login(id: string, password: string) {
        try {
            // 세션 쿠키 초기화
            await this.client.get("https://www.classcard.net/Login").catch(() => {});

            // LoginProc으로 로그인 (세션 쿠키 기반)
            const res: AxiosResponse = await this.client.post(
                "https://www.classcard.net/LoginProc",
                `login_id=${encodeURIComponent(id)}&login_pwd=${encodeURIComponent(password)}`
            );

            if (!res?.data) throw new Error("응답이 없습니다. (0)");
            if (res.data.result !== "ok") {
                const msgMap: Record<string, string> = {
                    "id": "아이디를 확인해주세요.",
                    "pwd": "비밀번호를 확인해주세요.",
                };
                throw new Error(msgMap[res.data.msg] || "로그인 실패: " + (res.data.msg || "알 수 없는 오류"));
            }

            // 메인 페이지에서 user 정보 추출
            const mainRes: AxiosResponse = await this.client.get("https://www.classcard.net/Main");
            const html: string = mainRes.data as string;

            const userIdxMatch = html.match(/var c_u\s*=\s*(\d+)/);
            if (!userIdxMatch || userIdxMatch[1] === "0") throw new Error("사용자 정보를 가져올 수 없습니다. (1)");
            this.user.id = Number(userIdxMatch[1]);

            const nameMatch = html.match(/var user_name\s*=\s*['"]([^'"]+)['"]/);
            if (nameMatch) this.user.name = nameMatch[1];

            const teacherMatch = html.match(/var is_teacher\s*=\s*(\d+)/);
            if (teacherMatch) this.user.isTeacher = teacherMatch[1] === "1";

            const proMatch = html.match(/var is_pro\s*=\s*(\d+)/);
            if (proMatch) this.user.isPro = proMatch[1] === "1";

            await this.getFolders();
            return { success: true, message: "로그인 성공", data: { user_id: this.user.id, name: this.user.name } };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    async sendLearnAll(type: learningType, percentageCheck: boolean = true) {
        try {
            if (!this.set.id || !this.class.id) throw new Error("세트 아이디 또는 클래스 아이디를 설정해야합니다. (0)");

            let activity = 0;
            if (type === learningType["암기학습"]) activity = 1;
            else if (type === learningType["리콜학습"]) activity = 2;
            else if (type === learningType["스펠학습"]) activity = 3;
            else throw new Error("알 수 없는 학습 타입입니다. (1)");

            let before: number = 0;
            let after: number = 0;
            let tryCount = 0;

            while (true) {
                before = percentageCheck ? (await this.getTotal().then(t => t?.data ? (t.data[type as keyof typeof t.data] as number) : 0) ?? 0) : 0;
                let params = new URLSearchParams();
                let ts = ClassCard.getTimestamp(Date.now());
                let p: any = {
                    "base_info": {
                        "s_ts": ts,
                        "set_idx": String(this.set.id),
                        "user_idx": this.user.id
                    },
                    "req_data": {
                        "fm_user_card_log": [{
                            "activity": activity,
                            "card_idx": -1,
                            "class_idx": this.class.id,
                            "deleted": 0,
                            "score": (Math.floor(before / 100) + 1),
                            "set_idx": this.set.id,
                            "ts": ts,
                            "user_idx": this.user.id
                        }],
                        "fm_user_class_learn_set": [],
                        "fm_user_play_score": [],
                        "fm_user_set_log": []
                    }
                };
                for (const card of this.set.study_data) p.req_data.fm_user_card_log.push({
                    "activity": activity,
                    "card_idx": card.card_idx,
                    "class_idx": this.class.id,
                    "deleted": 1,
                    "score": 1,
                    "set_idx": this.set.id,
                    "ts": ts,
                    "user_idx": this.user.id
                });
                params.append("p", JSON.stringify(p));

                // www 기반으로 전환
                await this.client.post(`https://www.classcard.net/sync/upsync_user_study_log`, params).catch(() => false);

                after = percentageCheck ? (await this.getTotal().then(t => t?.data ? (t.data[type as keyof typeof t.data] as number) : 0) ?? 0) : 0;
                if (!percentageCheck || after > before) break;
                tryCount++;
                if (tryCount > 1) throw new Error("알 수 없는 오류가 발생했습니다. (3)");
            };
            return { success: true, message: "성공", data: { before, after } };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    async addGameScore(game: Activity, score: number, fetchRank?: boolean) {
        try {
            if (!this.set.id || !this.class.id) throw new Error("세트 아이디 또는 클래스 아이디를 설정해야합니다. (0)");
            if (![4, 5].includes(game)) throw new Error("지원하지 않는 게임입니다. (1)");

            let params = new URLSearchParams();
            params.append("p", JSON.stringify({
                "base_info": { "s_ts": "", "set_idx": this.set.id.toString(), "user_idx": this.user.id.toString() },
                "req_data": {
                    "fm_user_card_log": [],
                    "fm_user_class_learn_set": [],
                    "fm_user_play_score": [{
                        "activity": game,
                        "class_idx": this.class.id,
                        "score": score,
                        "score_idx": 0,
                        "set_idx": this.set.id,
                        "user_idx": this.user.id
                    }],
                    "fm_user_set_log": []
                }
            }));

            let res: AxiosResponse | false = await this.client.post(
                `https://www.classcard.net/sync/upsync_user_study_log`, params
            ).catch(() => false);
            if (!res || !res.data?.res_data || res.data.result.code !== 200 || res.data.res_data.fm_user_play_score != 1) {
                throw new Error("알 수 없는 오류가 발생했습니다. (2)");
            }

            let s_ts = res.data.result.s_ts;
            let rank: { [key: string]: string | number | null } = { "class": null, "all": null };

            if (fetchRank) {
                try {
                    let rankParams = new URLSearchParams();
                    rankParams.append("user_idx", String(this.user.id));
                    rankParams.append("class_idx", String(this.class.id));
                    rankParams.append("set_idx", String(this.set.id));
                    rankParams.append("activity", String(game));
                    rankParams.append("limit", "100");
                    rankParams.append("current_score", String(score));
                    let rankRes: AxiosResponse | false = await this.client.post(
                        "https://www.classcard.net/ViewSetAsync/getRank", rankParams
                    ).catch(() => false);
                    if (rankRes && rankRes.data) {
                        for (const t of ["class", "all"]) {
                            const list = rankRes.data[t + "_rank_list"] || [];
                            let r = list.find((x: any) => x.user_idx === String(this.user.id) && x.reg_date === s_ts);
                            rank[t] = r ? r.rank : (t === "class" ? "오류" : "순위가 100등 보다 낮습니다.");
                        };
                    }
                } catch {};
            };
            return { success: true, message: "성공", data: { rank } };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    async getSetInfo(setId: number) {
        try {
            // sync_card로 카드 목록 획득
            let params = new URLSearchParams();
            params.append("p", JSON.stringify({
                "base_info": { "s_ts": "", "set_idx": String(setId), "user_idx": this.user.id || "" }
            }));
            let syncRes: AxiosResponse | false = await this.client.post(
                "https://www.classcard.net/sync/sync_card", params
            ).catch(() => false);
            if (!syncRes || !syncRes.data?.res_data) throw new Error("세트 정보를 가져올 수 없습니다. (0)");

            const cards = (syncRes as AxiosResponse).data.res_data.fm_card as any[];
            if (!cards?.length) throw new Error("카드 목록이 없습니다. (1)");
            const activeCards = cards.filter((c: any) => c.deleted === "0");
            if (!activeCards.length) throw new Error("이 세트에 활성화된 카드가 없습니다. (2)");

            // 세트 이름/타입은 Memorize 페이지에서 파싱
            let setName = `세트 ${setId}`;
            let setTypeVal = 1;
            try {
                let pageRes: AxiosResponse | false = await this.client.get(
                    `https://www.classcard.net/Memorize/${setId}`
                ).catch(() => false);
                if (pageRes && typeof pageRes.data === "string") {
                    const html = pageRes.data as string;
                    const nameMatch = html.match(/var set_name\s*=\s*['"]([^'"]+)['"]/);
                    if (nameMatch) setName = nameMatch[1];
                    const typeMatch = html.match(/var set_type\s*=\s*(\d+)/);
                    if (typeMatch) setTypeVal = Number(typeMatch[1]);
                    if (setName === `세트 ${setId}`) {
                        const titleMatch = html.match(/<title>([^<|]+)/);
                        if (titleMatch) setName = titleMatch[1].trim();
                    }
                }
            } catch {}

            const study_data = activeCards.map((c: any) => ({ card_idx: Number(c.card_idx) }));
            const set: { id: number, name: string, type: number, study_data: { card_idx: number }[] } = { id: setId, name: setName, type: setTypeVal, study_data };
            return { success: true, message: "", data: set };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    async setSetInfo(setId: number) {
        try {
            let res = await this.getSetInfo(setId);
            if (!res!.success) throw new Error(res!.message + " (0)");
            this.set = res?.data!;
            return { success: true, message: "세트 정보가 설정되었습니다.", data: this.set };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    async getClassInfo(classId: number) {
        try {
            let res = await this.getClasses();
            if (!res!.success) throw new Error(res!.message + " (0)");
            let classInfo = this.classes.find(x => x.id === classId);
            if (!classInfo) throw new Error("클래스를 찾을 수 없습니다. (1)");
            return { success: true, message: "", data: classInfo };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    async setClassInfo(classId: number) {
        try {
            let res = await this.getClassInfo(classId);
            if (!res!.success) throw new Error(res!.message + " (0)");
            this.class = res?.data!;
            return { success: true, message: "클래스 정보가 설정되었습니다.", data: this.set };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    async getTotal() {
        try {
            if (!this.set.id || !this.class.id) throw new Error("세트 아이디 또는 클래스 아이디를 설정해야합니다. (0)");

            let data: { Memorize: number, Recall: number, Spell: number, Test: number[] } = {
                Memorize: 0, Recall: 0, Spell: 0, Test: []
            };

            // 테스트 점수 조회
            try {
                if (this.class.id > 0 && this.user.id > 0) {
                    let p = new URLSearchParams();
                    p.append("set_idx", String(this.set.id));
                    p.append("class_idx", String(this.class.id));
                    let tr: AxiosResponse | false = await this.client.post(
                        "https://www.classcard.net/ViewSetAsync/getTestScore", p
                    ).catch(() => false);
                    if (tr && tr.data?.result === "ok") {
                        data.Test = (tr.data.test_score_log || []).map((x: any) => Number(x.score));
                    }
                }
            } catch { data.Test = []; };

            // sync_card로 학습 현황 조회
            let params = new URLSearchParams();
            params.append("p", JSON.stringify({
                "base_info": { "s_ts": "", "set_idx": this.set.id || "", "user_idx": this.user.id || "" }
            }));
            var sync_card: {
                "user_idx": string, "set_idx": string, "activity": string,
                "card_idx": string, "score": string, "deleted": string, "ts": string
            }[] = await this.client.post(
                `https://www.classcard.net/sync/sync_card`, params
            ).then(res => res.data.res_data.fm_user_card_log).catch(() => []);

            if (!sync_card) sync_card = [];
            let done = sync_card.filter(c =>
                c.score === "1" && c.deleted === "0" && c.card_idx !== "-1" && !!c.user_idx && !!c.set_idx && !!c.activity
            );
            for (var t of ["Memorize", "Recall", "Spell"]) {
                let activity = String(Activity[t as keyof typeof Activity]);
                data[t as "Memorize" | "Recall" | "Spell"] = done.filter(c => c.activity === activity).length > 0
                    ? Math.round((done.filter(c => c.activity === activity).length / this.set.study_data.length * 100) * 1e2) / 1e2
                    : 0;
            };
            let repeat = sync_card.filter(c =>
                c.deleted === "0" && c.card_idx === "-1" && !!c.user_idx && !!c.set_idx && !!c.activity
            );
            for (var t of ["Memorize", "Recall", "Spell"]) {
                let activity = String(Activity[t as keyof typeof Activity]);
                data[t as "Memorize" | "Recall" | "Spell"] += repeat.filter(c => c.activity === activity).length > 0
                    ? repeat.filter(c => c.activity === activity).map(c => Number(c.score)).reduce((a, b) => a + b, 0) * 100
                    : 0;
            };
            return { success: true, message: "성공", data };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    async getSets(folderName: string, classId?: number) {
        try {
            if (folderName === "클래스" && !classId) throw new Error("클래스 아이디를 인자로 전달해야 합니다. (0)");
            let sets: { id: number, name: string, type: number }[] = [];

            if (folderName === "이용한 세트" || folderName === "만든 세트") {
                let params = new URLSearchParams();
                params.append("p", JSON.stringify({
                    "base_info": { "g_class_full_sync": 1, "s_ts": "", "set_idx": "", "user_idx": this.user.id }
                }));
                let res: AxiosResponse | false = await this.client.post(
                    `https://www.classcard.net/sync/sync_set_class_v3`, params
                ).catch(() => false);
                if (!res || !res.data?.res_data || res.data.result.code !== 200) throw new Error("세트 목록을 가져올 수 없습니다. (1)");
                let fm_set = ((res as AxiosResponse).data.res_data.fm_set as {
                    set_idx: string, user_idx: string, deleted: string,
                    recent: boolean, name: string, is_wrong_answer: string, set_type: string
                }[]).map(set => {
                    set.recent = false;
                    if (((res as AxiosResponse).data.res_data.fm_user_set_log as { set_idx: string }[])?.find(s => s.set_idx === set.set_idx)) set.recent = true;
                    return set;
                });
                sets = fm_set.filter(set =>
                    Number(set.set_idx) > 0 && set.is_wrong_answer === "0" && set.deleted === "0" &&
                    (folderName === "이용한 세트" ? set.recent : Number(set.user_idx) === this.user.id)
                ).map(set => ({ id: Number(set.set_idx), name: set.name, type: Number(set.set_type) }));
            } else {
                if (folderName === "클래스") {
                    await this.setClassInfo(classId!).then(r => {
                        if (!r!.success) throw new Error((r!.message || "알 수 없는 오류가 발생했습니다.") + " (2)");
                    });
                    // sync_set_class_v3에서 클래스 세트 추출
                    let params = new URLSearchParams();
                    params.append("p", JSON.stringify({
                        "base_info": { "g_class_full_sync": 1, "s_ts": "", "set_idx": "", "user_idx": this.user.id }
                    }));
                    let res: AxiosResponse | false = await this.client.post(
                        `https://www.classcard.net/sync/sync_set_class_v3`, params
                    ).catch(() => false);
                    if (res && res.data?.res_data?.fm_class_set) {
                        const classSets = ((res as AxiosResponse).data.res_data.fm_class_set as any[])
                            .filter(s => s.class_idx === String(classId) && s.deleted === "0");
                        const setIds = classSets.map(s => s.set_idx);
                        if ((res as AxiosResponse).data.res_data.fm_set) {
                            sets = ((res as AxiosResponse).data.res_data.fm_set as any[])
                                .filter(s => setIds.includes(s.set_idx) && s.deleted === "0")
                                .map(s => ({ id: Number(s.set_idx), name: s.name, type: Number(s.set_type) }));
                        }
                    }
                    if (!sets.length) {
                        throw new Error("클래스 세트 목록을 가져올 수 없습니다. (3)");
                    }
                } else {
                    // 폴더 세트
                    let params = new URLSearchParams();
                    params.append("p", JSON.stringify({
                        "base_info": { "g_class_full_sync": 1, "s_ts": "", "set_idx": "", "user_idx": this.user.id }
                    }));
                    let res: AxiosResponse | false = await this.client.post(
                        `https://www.classcard.net/sync/sync_set_class_v3`, params
                    ).catch(() => false);
                    if (!res || !res.data?.res_data?.fm_set) throw new Error("세트 목록을 가져올 수 없습니다. (4)");
                    sets = ((res as AxiosResponse).data.res_data.fm_set as any[])
                        .filter(s => s.deleted === "0" && s.is_wrong_answer === "0")
                        .map(s => ({ id: Number(s.set_idx), name: s.name, type: Number(s.set_type) }));
                }
            };
            return { success: true, message: "성공", data: sets };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    async getClasses() {
        try {
            // sync_set_class_v3에서 클래스 목록
            let params = new URLSearchParams();
            params.append("p", JSON.stringify({
                "base_info": { "g_class_full_sync": 1, "s_ts": "", "set_idx": "", "user_idx": this.user.id }
            }));
            let syncRes: AxiosResponse | false = await this.client.post(
                "https://www.classcard.net/sync/sync_set_class_v3", params
            ).catch(() => false);

            let classes: { id: number, name: string }[] = [];

            if (syncRes && syncRes.data?.res_data?.fm_class) {
                classes = ((syncRes as AxiosResponse).data.res_data.fm_class as any[])
                    .filter(c => c.deleted === "0")
                    .map(c => ({ id: Number(c.class_idx), name: c.name }));
            } else {
                // 메인 페이지에서 파싱 (fallback)
                let res: AxiosResponse | false = await this.client.get("https://www.classcard.net/Main").catch(() => false);
                if (!res || typeof res.data !== "string") throw new Error("클래스 목록을 가져올 수 없습니다.");
                const html = res.data as string;
                const matches = [...html.matchAll(/href="\/ClassMain\/(\d+)"[^>]*>\s*([^<]+)/g)];
                const seen = new Set<number>();
                classes = matches.map(m => ({ id: Number(m[1]), name: m[2].trim() }))
                    .filter(c => c.id > 0 && c.name.length > 0 && !seen.has(c.id) && seen.add(c.id));
            }

            this.classes = classes;
            return { success: true, message: "성공", data: classes };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    async getFolders() {
        try {
            let folders: typeof this.folders = [
                { "name": "이용한 세트", "id": 0, "path": "/Main", "default": true },
                { "name": "만든 세트", "id": 0, "path": "/make", "default": true }
            ];
            let res: AxiosResponse | false = await this.client.get("https://www.classcard.net/Main").catch(() => false);
            if (res && typeof res.data === "string") {
                const html = res.data as string;
                const folderMatches = [...html.matchAll(/href="\/folder\/(\d+)"[^>]*>\s*([^<]+)/g)];
                folderMatches.forEach(m => {
                    const id = Number(m[1]);
                    const name = m[2].trim();
                    if (id > 0 && name.length > 0 && !folders.find(f => f.id === id)) {
                        folders.push({ "name": name, "id": id, "path": "/folder/" + id, "default": false });
                    }
                });
            }
            this.folders = folders;
            return { success: true, message: "성공", data: folders };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    async postTest() {
        try {
            if (!this.set.id || !this.class.id) throw new Error("세트 아이디 또는 클래스 아이디를 설정해야합니다. (0)");
            if (!this.user.id) throw new Error("로그인이 필요합니다. (0-1)");

            // 테스트 점수 기록 조회
            let testInfoParams = new URLSearchParams();
            testInfoParams.append("set_idx", String(this.set.id));
            testInfoParams.append("class_idx", String(this.class.id));
            let testInfoRes: AxiosResponse | false = await this.client.post(
                "https://www.classcard.net/ViewSetAsync/getTestScore", testInfoParams
            ).catch(() => false);

            let max_try_cnt = 70;
            let current = 1;
            if (testInfoRes && testInfoRes.data?.result === "ok") {
                const log = (testInfoRes as AxiosResponse).data.test_score_log || [];
                max_try_cnt = Number((testInfoRes as AxiosResponse).data.max_try_cnt) || 70;
                if (max_try_cnt <= log.length) throw new Error(`이 테스트는 최대 ${max_try_cnt}번 시도할 수 있습니다. (2)`);
                current = log.length + 1;
            }

            // ClassTest 페이지 접근 (세션 쿠키 필요)
            let testPageRes: AxiosResponse | false = await this.client.get(
                `https://www.classcard.net/ClassTest/${this.set.id}/${this.class.id}`, {
                    maxRedirects: 0,
                    validateStatus: s => s < 400
                }
            ).catch(() => false);

            if (!testPageRes || (testPageRes.status === 307)) {
                throw new Error("테스트 접근 실패. 로그인 먼저 진행해주세요. (3)");
            }

            const html = testPageRes.data as string;
            const scoreIdxMatch = html.match(/var score_idx\s*=\s*['"]?(\d+)['"]?/);
            if (!scoreIdxMatch) throw new Error("테스트 score_idx를 찾을 수 없습니다. (4)");
            const score_idx = scoreIdxMatch[1];

            const questMatch = html.match(/var quest_list\s*=\s*(\[[\s\S]+?\]);/);
            if (!questMatch) throw new Error("문제 목록을 찾을 수 없습니다. (5)");
            let questions: any[] = JSON.parse(questMatch[1]);

            let submitParams = new URLSearchParams();
            submitParams.append("class_idx", String(this.class.id));
            submitParams.append("is_only_wrong", "0");
            submitParams.append("question", JSON.stringify(questions.map((q: any) => ({
                "card_idx": q.card_idx,
                "test_card_idx": q.test_card_idx,
                "is_pre_user": "0",
                "correct_yn": "1",
                "subjective_yn": q.subjective_yn,
                "user_input": q.subjective_yn === "1" ? q.front : q.answer_option_no,
                "answer": q.subjective_yn === "1" ? q.front : (q.option_info?.find((o: any) => o.option_idx === q.answer_option_no)?.option_text || ""),
            }))));
            submitParams.append("score", "100");
            submitParams.append("score_idx", score_idx);
            submitParams.append("set_idx", String(this.set.id));

            let submitRes: AxiosResponse | false = await this.client.post(
                `https://www.classcard.net/ClassMainAsync/submitTest`, submitParams
            ).catch(() => false);
            if (!submitRes || submitRes.data?.result !== "ok") throw new Error("테스트 제출 실패. (6)");

            return { success: true, message: `${current}차 테스트 만점 제출 완료.`, data: submitRes.data };
        } catch (e) {
            if (e instanceof Error) return { success: false, message: e.message, error: { message: e.message, stack: e.stack } };
        };
    };

    static getTimestamp(t?: number): string {
        const d = new Date(t || Date.now());
        const pad = (n: number) => n.toString().padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
};

export class QuizBattle extends EventEmitter {
    private ws!: Websocket.WebSocket;
    battleID: number;
    private pongTimer!: NodeJS.Timeout;
    battleInfo!: {
        b_mode: number,
        test_id: number,
        test_time: number,
        b_user_idx: string,
        test_random: boolean,
        b_name: string,
        set_idx: number,
        set_name: string,
        set_type: number,
        quest_list: {
            test_card_idx: string,
            front: string,
            back: string,
            img_path: string,
            audio_path: string,
            example_sentence: string,
            q_option: string,
            subjective_yn: string,
            answer_option_no: string,
            option_info: [],
            example_front: string,
            example_back: string,
            example_data: string,
            back_data: string,
            front_quest: [],
            back_quest: [],
            exam_quest: [],
            weight: number
        }[]
    };
    userName: string;
    ready: boolean;
    joined: boolean;
    score: number;
    correct: number;
    wrong: number;
    classAvg: number;
    round: {
        remaining: number;
        correct: number;
        wrong: number;
        quest: { card_idx: string, score: number, correct_yn: number }[]
    };
    b_quest_idx: number;

    constructor(battleID: number) {
        super();
        this.battleID = battleID;
        this.score = 1000;
        this.correct = 0;
        this.wrong = 0;
        this.classAvg = 0;
        this.ready = false;
        this.joined = false;
        this.userName = "";
        this.round = { remaining: 5, correct: 0, wrong: 0, quest: [] };
        this.b_quest_idx = 0;
    };

    init(): Promise<boolean> {
        return new Promise((resolve) => {
            let port = 800;
            if (this.battleID > 18999 && this.battleID < 28000) port = 801;
            else if (this.battleID > 27999 && this.battleID < 37000) port = 802;
            else if (this.battleID > 36999 && this.battleID < 46000) port = 803;
            else if (this.battleID > 45999 && this.battleID < 55000) port = 804;
            else if (this.battleID > 54999 && this.battleID < 64000) port = 805;
            else if (this.battleID > 63999 && this.battleID < 73000) port = 806;
            else if (this.battleID > 72999 && this.battleID < 82000) port = 807;
            else if (this.battleID > 81999 && this.battleID < 91000) port = 808;
            else if (this.battleID > 90999 && this.battleID < 100000) port = 809;

            this.ws = new Websocket("wss://mobile3.classcard.net/wss_" + port);
            this.ws.on("message", (m: Websocket.RawData) => this.onMessage(m));
            this.ws.on("open", async () => {
                this.#sendPong();
                this.sendMessage({
                    battle_id: this.battleID,
                    cmd: "b_check",
                    is_auto: false,
                    major_ver: 8,
                    minor_ver: 0
                });
                while (!this.ready) await sleep(500);
                resolve(true);
            });
        });
    };

    sendMessage(message: string | Object): void {
        if (this.ws.readyState === this.ws.CLOSED || this.ws.readyState === this.ws.CLOSING || this.ws.readyState === this.ws.CONNECTING) return;
        this.ws.send(typeof message === "object" ? JSON.stringify(message) : message);
        this.#sendPong();
    };

    #sendPong(): void {
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pongTimer = setTimeout(() => this.sendMessage({ cmd: 'pong' }), 10000);
    };

    setScore(score: number, force: boolean = true) {
        this.score = score;
        this.sendMessage({ "cmd": "b_get_rank", "total_score": this.score, "unknown": 0, "quest": this.round.quest });
    };

    mark(correct: boolean) {
        if (this.b_quest_idx < 0) this.b_quest_idx = 0;
        let quest = this.battleInfo.quest_list[this.b_quest_idx];
        this.round.remaining--;
        this.round.quest.push({
            card_idx: quest.test_card_idx,
            score: correct ? (100 * (quest?.weight || 1)) : 0,
            correct_yn: correct ? 1 : 0
        });
        if (correct) { this.round.correct++; this.correct++; }
        else { this.round.wrong++; this.wrong++; }
        this.score += correct ? (100 * (quest?.weight || 1)) : 0;
        if (this.round.remaining == 0) {
            if (this.round.wrong <= 0) this.score += 100;
            this.sendMessage({ "cmd": "b_get_rank", "total_score": this.score, "unknown": 0, "quest": this.round.quest });
            this.round = { remaining: 5, correct: 0, wrong: 0, quest: [] };
        };
        this.b_quest_idx++;
        if (this.b_quest_idx >= this.battleInfo.quest_list.length) {
            this.b_quest_idx = 0;
            this.makeQuest();
        };
        return { nextQuestion: this.battleInfo.quest_list[this.b_quest_idx] };
    };

    async join(name: string) {
        this.userName = name;
        this.sendMessage({
            cmd: "b_join",
            battle_id: this.battleID,
            browser: "Chrome",
            is_add: 0,
            is_auto: false,
            major_ver: 8,
            minor_ver: 0,
            platform: "Windows 10",
            user_name: this.userName,
        });
        while (!this.joined) await sleep(500);
        return true;
    };

    leave(): boolean {
        if (this.ws.readyState !== this.ws.OPEN) return false;
        this.ws.close();
        return true;
    };

    async onMessage(message: Websocket.RawData) {
        let data: any = JSON.parse(message.toString());
        if (data.cmd === "b_check") {
            if (data.result == "fail") {
                this.ws.close();
                this.emit("error", (data.reason || "알 수 없는 오류가 발생했습니다.") + " (1)");
                return;
            } else { this.ready = true; };
        };
        if (data.cmd === "b_join" && data.result === "ok") {
            if (data.b_mode === 2 || data.set_type === 5) {
                this.emit("error", "이 배틀 형식은 지원하지 않습니다. (2)");
                return;
            };
            this.battleInfo = {
                b_mode: data.b_mode,
                test_id: data.test_id,
                test_time: data.test_time,
                b_user_idx: data.b_user_idx,
                test_random: data.test_random,
                b_name: data.b_name,
                set_idx: data.set_idx,
                set_name: data.set_name,
                set_type: data.set_type,
                quest_list: []
            };
            await axios.post("https://b.classcard.net/ClassBattle/battle_quest", "test_id=" + this.battleInfo.test_id)
                .then(res => this.battleInfo.quest_list = res.data.quest_list);
            this.makeQuest();
            this.sendMessage({
                cmd: "b_join",
                battle_id: this.battleID,
                browser: "Chrome",
                is_add: 1,
                is_auto: false,
                major_ver: 8,
                minor_ver: 0,
                platform: "Windows 10",
                user_name: this.userName,
            });
        };
        if (data.cmd === "b_team") this.joined = true;
        if (data.cmd === "b_out") {
            if (data.is_today) this.emit("error", "선생님이 오늘 자정까지 접속을 차단하였습니다. (3)");
            else this.emit("error", "선생님께서 배틀을 종료하셨거나 오류입니다. (4)");
            return;
        };
        if (data.avg_score) this.classAvg = data.avg_score;
        if (data.cmd === "b_test_start") { await sleep(3000); this.emit("start"); };
        if (data.cmd === "b_test_end") {
            await sleep(3000);
            this.sendMessage({ "cmd": "b_get_rank", "total_score": this.score, "unknown": 0, "quest": this.round.quest });
            this.emit("end");
        };
    };

    makeQuest(): void {
        if (this.battleInfo.set_type == 5) return;
        var items: any[] = [];
        var item: any;
        if (this.battleInfo.set_type == 4) {
            while (item = this.battleInfo.quest_list.shift()) {
                item.q_option = '2';
                item.option_info = item.front_quest;
                items.push(item);
            };
        } else {
            var total_cnt = this.battleInfo.quest_list.length;
            var es_cnt = Math.floor(total_cnt * 0.1);
            var img_cnt = Math.floor(total_cnt * 0.1);
            var audio_cnt = Math.floor(total_cnt * 0.1);
            var make_cnt = 0;
            var limit_cnt = 0;
            var loop_cnt = 0;

            if (audio_cnt > 0) {
                QuizBattle.fy(this.battleInfo.quest_list); make_cnt = 0; loop_cnt = 0; limit_cnt = this.battleInfo.quest_list.length;
                while (item = this.battleInfo.quest_list.shift()) {
                    loop_cnt++;
                    if (!item.audio_path || item.audio_path == '0' || item.back_quest.length == 0 || item.subjective_yn == '1') {
                        this.battleInfo.quest_list.push(item);
                        if (loop_cnt < limit_cnt) continue; else break;
                    };
                    item.q_option = '5'; item.option_info = item.back_quest; items.push(item); make_cnt++;
                    if (make_cnt >= audio_cnt || loop_cnt >= limit_cnt) break;
                };
            };
            if (es_cnt > 0) {
                QuizBattle.fy(this.battleInfo.quest_list); make_cnt = 0; loop_cnt = 0; limit_cnt = this.battleInfo.quest_list.length;
                while (item = this.battleInfo.quest_list.shift()) {
                    loop_cnt++;
                    if (item.example_sentence === undefined || item.example_sentence == null || item.example_sentence.length == 0 || item.subjective_yn == '1') {
                        this.battleInfo.quest_list.push(item);
                        if (loop_cnt < limit_cnt) continue; else break;
                    };
                    item.q_option = '3'; item.option_info = item.exam_quest; items.push(item); make_cnt++;
                    if (make_cnt >= es_cnt || loop_cnt >= limit_cnt) break;
                };
            };
            if (img_cnt > 0) {
                QuizBattle.fy(this.battleInfo.quest_list); make_cnt = 0; loop_cnt = 0; limit_cnt = this.battleInfo.quest_list.length;
                while (item = this.battleInfo.quest_list.shift()) {
                    loop_cnt++;
                    if (!item.img_path || item.subjective_yn == '1') {
                        this.battleInfo.quest_list.push(item);
                        if (loop_cnt < limit_cnt) continue; else break;
                    };
                    item.q_option = '4'; item.option_info = item.front_quest; items.push(item); make_cnt++;
                    if (make_cnt >= img_cnt || loop_cnt >= limit_cnt) break;
                };
            };
            QuizBattle.fy(this.battleInfo.quest_list);
            var half_cnt = Math.floor(this.battleInfo.quest_list.length / 2);
            make_cnt = 0; loop_cnt = 0; limit_cnt = this.battleInfo.quest_list.length;
            if (half_cnt > 0) {
                while (item = this.battleInfo.quest_list.shift()) {
                    loop_cnt++;
                    if (!item.back || item.front_quest.length == 0 || item.subjective_yn == '1') {
                        this.battleInfo.quest_list.push(item);
                        if (loop_cnt < limit_cnt) continue; else break;
                    };
                    item.q_option = '2'; item.option_info = item.front_quest; items.push(item); make_cnt++;
                    if (make_cnt >= half_cnt || loop_cnt >= limit_cnt) break;
                }
            };
            QuizBattle.fy(this.battleInfo.quest_list); loop_cnt = 0; limit_cnt = this.battleInfo.quest_list.length;
            while (item = this.battleInfo.quest_list.shift()) {
                loop_cnt++;
                if (!item.front || item.back_quest.length == 0 || item.subjective_yn == '1') {
                    this.battleInfo.quest_list.push(item);
                    if (loop_cnt < limit_cnt) continue; else break;
                };
                item.q_option = '1'; item.option_info = item.back_quest; items.push(item);
                if (loop_cnt >= limit_cnt) break;
            };
            QuizBattle.fy(this.battleInfo.quest_list); loop_cnt = 0; limit_cnt = this.battleInfo.quest_list.length;
            while (item = this.battleInfo.quest_list.shift()) {
                loop_cnt++;
                if (!item.img_path || item.subjective_yn == '1') {
                    this.battleInfo.quest_list.push(item);
                    if (loop_cnt < limit_cnt) continue; else break;
                };
                item.q_option = '4'; item.option_info = item.front_quest; items.push(item); make_cnt++;
                if (loop_cnt >= limit_cnt) break;
            };
            QuizBattle.fy(this.battleInfo.quest_list); loop_cnt = 0; limit_cnt = this.battleInfo.quest_list.length;
            while (item = this.battleInfo.quest_list.shift()) {
                loop_cnt++;
                item.q_option = '2'; item.option_info = item.front_quest; items.push(item);
                if (loop_cnt >= limit_cnt) break;
            };
        };
        items.map(quest => {
            quest.weight = 1;
            if (quest && (quest.q_option == "3" || quest.q_option == "4" || quest.q_option == "5")) quest.weight = 2;
            return quest;
        });
        this.battleInfo.quest_list = items;
        this.battleInfo.quest_list.sort((a, b) => {
            var a1 = Number(a.test_card_idx), b1 = Number(b.test_card_idx);
            if (a1 < b1) return -1; if (a1 > b1) return 1; return 0;
        });
    };

    static fy(a: Array<object>, b?: any, c?: any, d?: any): void {
        c = a.length;
        while (c) b = Math.random() * (--c + 1) | 0, d = a[c], a[c] = a[b], a[b] = d;
    };
};

export declare interface QuizBattle {
    on(event: "error", listener: (error: string) => void): this;
    on(event: "start", listener: () => void): this;
    on(event: "end", listener: () => void): this;
};
