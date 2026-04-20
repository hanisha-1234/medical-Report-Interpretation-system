require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ✅ PostgreSQL Connection
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_DATABASE || 'postgres',
    password: process.env.DB_PASSWORD || '12345678',
    port: process.env.DB_PORT || 5432,
});

// ✅ Ensure required tables exist
async function createTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_interactions (
                id SERIAL PRIMARY KEY,
                query TEXT NOT NULL,
                response TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            );
        `);

        console.log("✅ Checked/Created required tables.");
    } catch (err) {
        console.error("❌ Error creating tables:", err.message);
    }
}
createTables();

// ✅ Function to store user interactions
async function logInteraction(userQuery, response) {
    try {
        await pool.query(
            `INSERT INTO user_interactions (query, response) VALUES ($1, $2)`,
            [userQuery, response]
        );
        console.log("✅ Logged interaction:", { query: userQuery, response });
    } catch (err) {
        console.error("❌ Error logging interaction:", err.message);
    }
}

// ✅ User Authentication: Signup
app.post('/signup', async (req, res) => {
    const { username, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hashedPassword]);
        res.status(201).json({ message: 'User registered successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Error signing up' });
    }
});

// ✅ User Authentication: Login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

        if (user.rows.length === 0) {
            return res.status(400).json({ error: 'User not found' });
        }

        const validPassword = await bcrypt.compare(password, user.rows[0].password);
        if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (err) {
        res.status(500).json({ error: 'Login error' });
    }
});

// ✅ Chatbot API with Enhanced Flow
app.post('/chat', async (req, res) => {
    const { query, language } = req.body;

    if (!query) {
        return res.status(400).json({ error: "Query is required" });
    }

    try {
        console.log("📥 Received query:", query);

        // 🧠 Step 1️⃣: Classify the query using Mistral-tiny
        const classificationPrompt = `Is the following query related to a medical issue? Respond with "YES" or "NO" only.\n\nQuery: ${query}`;
        const classificationResponse = await axios.post(
            process.env.MISTRAL_API_URL,
            {
                model: "mistral-tiny",
                messages: [{ role: "user", content: classificationPrompt }]
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const isMedicalQuery = classificationResponse.data.choices[0]?.message?.content?.trim();

        if (isMedicalQuery !== 'YES') {
            console.log("❌ Non-medical query detected.");
            return res.json({
                response: "I am a medical assistant. Please ask me medical-related questions."
            });
        }

        console.log("✅ Medical query detected. Proceeding...");

        // 🔍 Step 2️⃣: Search for context in PostgreSQL
        let context = '';
        let aiResponse = '';

        const result = await pool.query(
            `SELECT "Doctor" FROM medicaldata 
             WHERE LOWER("Description") LIKE LOWER($1) 
             OR LOWER("Patient") LIKE LOWER($1) 
             OR LOWER("Category") LIKE LOWER($1)`,
            [`%${query}%`]
        );

        if (result.rows.length > 0) {
            context = result.rows[0].Doctor;
            console.log("📌 Database match found. Passing to Mistral...");
        } else {
            console.log("❌ No database match. Sending direct query to Mistral...");
        }

        // 🧠 Step 3️⃣: Create AI prompt for medical response
        const prompt = context
            ? `User Query: ${query}\nDoctor's Advice: ${context}\nAI Response:`
            : `User Query: ${query}\nAI Response:`;

        // 🤖 Step 4️⃣: Generate AI response with Mistral-tiny
        const mistralResponse = await axios.post(
            process.env.MISTRAL_API_URL,
            {
                model: "mistral-tiny",
                messages: [{ role: "user", content: prompt }]
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        aiResponse = mistralResponse.data.choices[0]?.message?.content?.trim() || "No response generated.";

        // ✅ Step 5️⃣: Translate response if needed
        if (language && language !== 'en') {
            const translateResponse = await axios.post(
                `https://api.mymemory.translated.net/get?q=${encodeURIComponent(aiResponse)}&langpair=en|${language}`
            );
            aiResponse = translateResponse.data.responseData.translatedText;
        }

        // ✅ Step 6️⃣: Store interaction in PostgreSQL
        await logInteraction(query, aiResponse);

        res.json({ response: aiResponse });
    } catch (error) {
        console.error("❌ Error processing request:", error.message);
        res.status(500).json({
            error: 'Server error. Please try again.',
            response: "⚠️ AI is currently unavailable. Please try again later."
        });
    }
});

// ✅ Start the server
app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
});
