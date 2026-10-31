# Nhip do

Ung dung quan ly muc tieu ca nhan, chay hoan toan tren trinh duyet. Du lieu muc tieu va bao cao hoan tat nam trong IndexedDB cua trinh duyet, nen khong can dang nhap hay backend.

App tach ro hai lop:

- Muc tieu luu han chot va tien do thuc te, duoc cap nhat thu cong.
- Daily plan la template lap lai theo ngay/tuan, co the lien ket voi mot muc tieu de tham chieu nhung khong tu dong thay doi tien do muc tieu. Dung `Nhan ban` de tao bien the ma khong can nhap lai.
- Muc tieu thuoc `Tiet kiem` co muc tieu theo thang bat buoc. Nut `Ghi thang` luu so tien thuc te cua tung thang va cap nhat truc tiep tien do goal; ghi lai cung mot thang se thay the ban ghi cu, khong cong hai lan.
- Tab `Nhin lai` thong ke tung tuan/thang tu nhat ky daily. Khi mot tuan ket thuc, `Chot review tuan` la buoc duy nhat cong phan tien do thuc te vao cac goal lien ket; moi tuan chi chot mot lan de tranh cong trung.
- Moi daily plan co cuong do va quy tac khi bo lo. Quy tac `Bu 1 luot sau review` tao mot luot bu rieng, khong lam sai ty le hoan thanh lich chinh.
- Nut `Bat dau tu ngay mai` trong thu vien plan xoa nhat ky daily, luot bu va review tuan de bat dau lai vao ngay hom sau. Goal va so tiet kiem khong bi thay doi.

## Chay local

Tu thu muc du an, chay mot static server de trinh duyet co mot origin on dinh cho IndexedDB:

```bash
python3 -m http.server 4173
```

Sau do mo `http://localhost:4173`. Nhan `Ctrl+C` trong terminal de dung server.

## Deploy Vercel

Day thu muc nay len mot Git repository, sau do import repository trong Vercel. Day la static site nen khong can cai dat build command hay environment variable.

Luu y: du lieu la theo tung trinh duyet/thiet bi. Deploy lai khong xoa du lieu da luu tren cung trinh duyet, nhung xoa du lieu trinh duyet hoac doi thiet bi se khong chuyen du lieu theo.
