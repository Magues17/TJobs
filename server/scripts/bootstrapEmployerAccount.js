import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import pool from '../db.js'

dotenv.config()

function safeTrim(value, maxLength = null) {
  if (value === undefined || value === null) return ''
  let normalized = String(value).trim()
  if (maxLength && normalized.length > maxLength) {
    normalized = normalized.slice(0, maxLength)
  }
  return normalized
}

function normalizeEmail(value) {
  return safeTrim(value, 255).toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

async function main() {
  const email = normalizeEmail(process.env.BOOTSTRAP_EMPLOYER_EMAIL || 'jobs@tarborojobs.com')
  const password = String(process.env.BOOTSTRAP_EMPLOYER_PASSWORD || '').trim()
  const businessName = safeTrim(process.env.BOOTSTRAP_EMPLOYER_BUSINESS_NAME || 'TarboroJobs', 255)
  const contactName = safeTrim(process.env.BOOTSTRAP_EMPLOYER_CONTACT_NAME || 'TarboroJobs Admin', 255)
  const website = safeTrim(process.env.BOOTSTRAP_EMPLOYER_WEBSITE || 'https://tarborojobs.com', 255)
  const city = safeTrim(process.env.BOOTSTRAP_EMPLOYER_CITY || 'Tarboro', 120)
  const industry = safeTrim(process.env.BOOTSTRAP_EMPLOYER_INDUSTRY || 'Job Board', 120)

  if (!email || !isValidEmail(email)) {
    throw new Error('BOOTSTRAP_EMPLOYER_EMAIL must be a valid email address.')
  }

  if (!password || password.length < 8) {
    throw new Error('BOOTSTRAP_EMPLOYER_PASSWORD must be set and be at least 8 characters long.')
  }

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    let employerId = null

    const [existingEmployers] = await connection.query(
      `
      SELECT id
      FROM employers
      WHERE LOWER(email) = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      [email]
    )

    if (existingEmployers.length > 0) {
      employerId = Number(existingEmployers[0].id)

      await connection.query(
        `
        UPDATE employers
        SET
          business_name = ?,
          industry = ?,
          contact_name = ?,
          email = ?,
          website = ?,
          city = ?,
          onboarding_completed = 1,
          subscription_status = 'active',
          access_status = 'active',
          status = 'active',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [businessName, industry, contactName, email, website || null, city || null, employerId]
      )
    } else {
      const [insertEmployer] = await connection.query(
        `
        INSERT INTO employers
        (
          business_name,
          industry,
          contact_name,
          email,
          website,
          city,
          onboarding_completed,
          subscription_status,
          access_status,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, 1, 'active', 'active', 'active')
        `,
        [businessName, industry || null, contactName || null, email, website || null, city || null]
      )

      employerId = Number(insertEmployer.insertId)
    }

    const [emailConflicts] = await connection.query(
      `
      SELECT id, employer_id
      FROM employer_users
      WHERE LOWER(email) = ?
      LIMIT 1
      `,
      [email]
    )

    if (emailConflicts.length > 0 && Number(emailConflicts[0].employer_id) !== employerId) {
      throw new Error(
        `Email ${email} is already attached to employer_id=${emailConflicts[0].employer_id}, not employer_id=${employerId}.`
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const [existingUsers] = await connection.query(
      `
      SELECT id
      FROM employer_users
      WHERE employer_id = ?
      LIMIT 1
      `,
      [employerId]
    )

    let employerUserId = null

    if (existingUsers.length > 0) {
      employerUserId = Number(existingUsers[0].id)

      await connection.query(
        `
        UPDATE employer_users
        SET
          email = ?,
          password_hash = ?,
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [email, passwordHash, employerUserId]
      )
    } else {
      const [insertUser] = await connection.query(
        `
        INSERT INTO employer_users
        (
          employer_id,
          email,
          password_hash,
          is_active
        )
        VALUES (?, ?, ?, 1)
        `,
        [employerId, email, passwordHash]
      )

      employerUserId = Number(insertUser.insertId)
    }

    await connection.query(
      `
      UPDATE employer_onboarding_tokens
      SET status = 'revoked', used_at = COALESCE(used_at, NOW())
      WHERE employer_id = ? AND status = 'pending'
      `,
      [employerId]
    )

    await connection.commit()

    console.log('Employer account is ready.')
    console.log(JSON.stringify({
      email,
      employer_id: employerId,
      employer_user_id: employerUserId,
      business_name: businessName,
      admin_login_supported: false,
      admin_note: 'Admin access still uses ADMIN_API_KEY in server/server.js. This email is an employer login, not a true admin login.'
    }, null, 2))
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('bootstrapEmployerAccount failed:', error)
  process.exit(1)
})