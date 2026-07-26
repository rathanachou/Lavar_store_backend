require('dotenv').config();

module.exports = {
  development: {
    username: "postgres",
    password: "rat123",
    database: "sala-express",
    host: "127.0.0.1",
    dialect: "postgres",
    pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
  },
  test: {
    username: "root",
    password: null,
    database: "database_test",
    host: "127.0.0.1",
    dialect: "mysql"
  },
  production: {
    use_env_variable: "DATABASE_URL",
    dialect: "postgres",
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  }
};