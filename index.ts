import admin, { ServiceAccount } from "firebase-admin";
import dotenv from "dotenv";
import express from "express";
// import csrf from "csurf";
import cookieParser from "cookie-parser";
import { resolve } from "path";
import { QueryTypes, Sequelize } from "sequelize";
import * as tedious from "tedious";

dotenv.config();
const serviceAccount: ServiceAccount = JSON.parse(
	process.env.SERVICE_ACCOUNT_KEY || ""
);

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
});

const app = express();
const port = process.env.PORT || 8080;

// const csrfMiddleware = csrf({ cookie: { sameSite: "lax" } });

app.use("/main", express.static(resolve("./frontend")));

app.use(express.json());
app.use(cookieParser());
// app.use(csrfMiddleware);

const sequelize = new Sequelize(
	process.env.DB_NAME || "",
	process.env.DB_USER || "",
	process.env.DB_PASSWORD || "",
	{
		host: process.env.DB_HOST || "localhost",
		dialect: "mssql",
		dialectModule: tedious,
	}
);

try {
	await sequelize.authenticate();
	console.log("Success");
} catch (err) {
	console.log(err);
}

// app.all("*", (req, res, next) => {
// 	res.cookie("XSRF-TOKEN", req.csrfToken());
// 	next();
// });

// app.get("/api/csrf", (req, res) => {
// 	res.sendStatus(200);
// });

app.get("/", (req, res) => {
	// res.status(200).send("Hello World!");
	res.sendFile(resolve("./frontend/index.html"));
});

app.post("/api/login", (req, res) => {
	const idToken: string = req.body.idToken || "";

	admin
		.auth()
		.verifyIdToken(idToken)
		.then(async (decodedToken) => {
			const users: any[] = await sequelize.query(
				`SELECT (AdministratorAccess) FROM Users WHERE FirebaseUID = '${decodedToken.uid}'`,
				{ type: QueryTypes.SELECT }
			);

			let adminAccess = false;

			if (users.length === 0) {
				await sequelize.query(
					`INSERT INTO Users (FirebaseUID, Email) VALUES ('${decodedToken.uid}', '${decodedToken.email}')`
				);
				await addCasesToUser(decodedToken.uid, "Weapon Case", 1);
				await addCasesToUser(decodedToken.uid, "Bravo Case", 1);
				await addCasesToUser(decodedToken.uid, "Hydra Case", 2);
			} else {
				adminAccess = users[0].AdministratorAccess;
				await addCasesToUser(decodedToken.uid, "Weapon Case", 1);
				await addCasesToUser(decodedToken.uid, "Bravo Case", 1);
				await addCasesToUser(decodedToken.uid, "Hydra Case", 2);
			}

			res.status(200).json(adminAccess);
			return;
		})
		.catch((err) => {
			console.log(err);
			res.status(401).send(err);
		});
});

app.get("/api/getcase", (req, res) => {
	const idToken = req.query.idToken;

	if (typeof idToken !== "string") {
		res.status(400).send("Bad Request, No ID Token");
		return;
	}

	admin
		.auth()
		.verifyIdToken(idToken)
		.then(async (decodedToken) => {
			await addCasesToUser(decodedToken.uid, "Weapon Case", 1);
			res.sendStatus(200);
			return;
		})
		.catch((err) => {
			res.status(401).send("Unauthorized Request");
			console.log(err);
			return;
		});
});

app.get("/api/inventory", (req, res) => {
	const idToken = req.query.idToken;

	if (typeof idToken !== "string") {
		res.status(400).send("Bad Request, No ID Token");
		return;
	}

	admin
		.auth()
		.verifyIdToken(idToken)
		.then(async (decodedToken) => {
			let inventory = await sequelize.query(
				`SELECT Cases.CaseName, Cases.ImagePath, SUM(InventoryDetails.Quantity) AS Quantity
				FROM Users
				INNER JOIN InventoryDetails
				ON Users.ID = InventoryDetails.UserID
				INNER JOIN Cases
				ON InventoryDetails.CaseID = Cases.ID
				WHERE Users.FirebaseUID = '${decodedToken.uid}' AND Quantity > 0
				GROUP BY Cases.CaseName, Cases.ImagePath`,
				{ type: QueryTypes.SELECT }
			);

			res.status(200).json(inventory);
		})
		.catch((err) => {
			console.log(err);
			res.status(401).send("Unauthorized Request");
		});
});

app.delete("/api/case", (req, res) => {
	const idToken = req.body.idToken || "";
	const caseName = req.body.caseName;

	if (typeof idToken !== "string" || typeof caseName !== "string") {
		console.log("Bad Request, No ID Token or Case Name");
		res.status(400).json(false);
		return;
	}

	admin
		.auth()
		.verifyIdToken(idToken)
		.then(async (decodedToken) => {
			let intventoryDetails: any[] = await sequelize.query(
				`SELECT InventoryDetails.ID, InventoryDetails.Quantity FROM Users
				INNER JOIN InventoryDetails
				ON Users.ID = InventoryDetails.UserID
				INNER JOIN Cases
				ON InventoryDetails.CaseID = Cases.ID
				WHERE Cases.CaseName = '${caseName}' AND Users.FirebaseUID = '${decodedToken.uid}'`,
				{ type: QueryTypes.SELECT }
			);

			if (intventoryDetails.length === 0) {
				console.log("No Records Found");
				res.status(200).json(false);
				return;
			}

			let removed = false;

			for (let i = 0; i < intventoryDetails.length; i++) {
				if (intventoryDetails[i].Quantity === 1 && !removed) {
					await sequelize.query(
						`DELETE FROM InventoryDetails WHERE InventoryDetails.ID = ${intventoryDetails[i].ID}`
					);
					removed = true;
				} else if (intventoryDetails[i].Quantity > 1 && !removed) {
					await sequelize.query(
						`UPDATE InventoryDetails SET InventoryDetails.Quantity = ${
							intventoryDetails[i].Quantity - 1
						} WHERE InventoryDetails.ID = ${
							intventoryDetails[i].ID
						}`
					);
					removed = true;
				} else if (intventoryDetails[i].Quantity === 0) {
					await sequelize.query(
						`DELETE FROM InventoryDetails WHERE InventoryDetails.ID = ${intventoryDetails[i].ID}`
					);
				}
			}

			console.log(removed);

			res.status(200).json(removed);
			return;
		})
		.catch((err) => {
			console.log(err);
			res.status(401).json(false);
			return;
		});
});

app.get("/api/items", (req, res) => {
	const idToken = req.query.idToken || "";
	const caseName = req.query.caseName;

	if (typeof idToken !== "string" || typeof caseName !== "string") {
		res.status(400).send("Bad Request, No ID Token or Case Name");
		return;
	}

	admin
		.auth()
		.verifyIdToken(idToken)
		.then(async (decodedToken) => {
			let items = await sequelize.query(
				`SELECT Items.ItemName, Items.ImagePath, Items.Rarity FROM Items
				INNER JOIN Cases
				ON Items.CaseID = Cases.ID
				WHERE Cases.CaseName = '${caseName}'`,
				{ type: QueryTypes.SELECT }
			);

			res.status(200).json(items);
		})
		.catch((err) => {
			console.log(err);
			res.status(401).send("Unauthorized");
		});
});

app.listen(port, () => {
	console.log(`Listening on http://localhost:${port}`);
});

async function addCasesToUser(
	firebaseUID: string,
	caseName: string,
	quantity: number
) {
	let user: any[] = await sequelize.query(
		`SELECT ID from Users WHERE FirebaseUID = '${firebaseUID}'`,
		{ type: QueryTypes.SELECT }
	);

	if (user.length === 0) {
		console.log("User not found with uid: " + firebaseUID);
		return;
	}

	const userID = user[0].ID;

	console.log("User ID: " + userID);

	let weaponCase: any[] = await sequelize.query(
		`SELECT ID FROM Cases WHERE CaseName = '${caseName}'`,
		{ type: QueryTypes.SELECT }
	);

	if (weaponCase.length === 0) {
		console.log("Case not found with name: " + caseName);
		return;
	}

	const caseID = weaponCase[0].ID;

	console.log("Case ID: " + caseID);

	let [result, metadata] = await sequelize.query(
		`INSERT INTO InventoryDetails VALUES (${userID}, ${caseID}, ${quantity})`,
		{ type: QueryTypes.INSERT }
	);

	console.log(result, metadata);
}
