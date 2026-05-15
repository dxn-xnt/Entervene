#backend
.venv\Scripts\activate

uvicorn app.main:app
uvicorn app.main:app --host 0.0.0.0 --reload


#frontend
npm run dev

#mobile
npx expo start

#sample accounts (login)
#teacher
m.cruz@school.edu.ph
hash_poly_02


Student Account
Email:				Password Hash: 

juan.delacruz@student.ph,  	hash_poly_03
maria.santos@student.ph,   	hash_poly_04
jose.reyes@student.ph,     	hash_poly_05
ana.gonzales@student.ph, 	hash_poly_06
carlos.mendoza@student.ph, 	hash_poly_07
luz.fernandez@student.ph,	hash_poly_08



mobile app
npx expo start
npx expo start --offline (if ever mag bug inig run)

